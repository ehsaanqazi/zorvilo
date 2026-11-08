//! Repository operations on top of libgit2.
//!
//! All functions are blocking; callers run them on a background thread.
//! HTTPS with username + token is supported. SSH remotes need the `ssh`
//! feature of `git2` (libssh2) which is not enabled in this build.

use std::path::{Path, PathBuf};

use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    BranchType, Cred, CredentialType, DiffFormat, DiffOptions, FetchOptions, IndexAddOption, ObjectType, Oid,
    PushOptions, RemoteCallbacks, Repository, RepositoryInitOptions, RepositoryState, ResetType, Signature, Sort,
    Status, StatusOptions,
};

#[derive(Debug, thiserror::Error)]
pub enum GitError {
    #[error("{}", .0.message())]
    Git(#[from] git2::Error),
    #[error("{0}")]
    Msg(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type GitResult<T> = Result<T, GitError>;

#[derive(Debug, Clone, Default)]
pub struct GitAuth {
    pub username: String,
    pub token: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Conflicted,
}

impl FileStatus {
    pub fn label(self) -> &'static str {
        match self {
            FileStatus::Added => "A",
            FileStatus::Modified => "M",
            FileStatus::Deleted => "D",
            FileStatus::Renamed => "R",
            FileStatus::Untracked => "?",
            FileStatus::Conflicted => "!",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
}

#[derive(Debug, Clone, Default)]
pub struct RepoStatus {
    pub branch: String,
    pub changed: Vec<ChangedFile>,
    pub ahead: usize,
    pub behind: usize,
    pub has_upstream: bool,
    pub merging: bool,
    pub conflicts: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PullOutcome {
    UpToDate,
    FastForward,
    Merged,
    /// merge stopped with conflicts in these paths (repository left in merge state)
    Conflicts(Vec<String>),
    NoRemoteBranch,
}

#[derive(Debug, Clone)]
pub struct CommitInfo {
    pub id: String,
    pub summary: String,
    pub author: String,
    pub time: i64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictSide {
    Ours,
    Theirs,
}

fn callbacks(auth: &GitAuth) -> RemoteCallbacks<'static> {
    let mut cb = RemoteCallbacks::new();
    let user = auth.username.clone();
    let token = auth.token.clone();
    let mut attempts = 0;
    cb.credentials(move |_url, username_from_url, allowed| {
        attempts += 1;
        if attempts > 2 {
            return Err(git2::Error::from_str("Git authentication failed — check the username/token in Git settings"));
        }
        if allowed.contains(CredentialType::USER_PASS_PLAINTEXT) && !token.is_empty() {
            let u = if !user.trim().is_empty() {
                user.clone()
            } else {
                username_from_url.unwrap_or("x-access-token").to_string()
            };
            return Cred::userpass_plaintext(&u, &token);
        }
        if allowed.contains(CredentialType::DEFAULT) {
            return Cred::default();
        }
        Err(git2::Error::from_str("this remote requires credentials — add an access token in Git settings"))
    });
    cb
}

fn fetch_options(auth: &GitAuth) -> FetchOptions<'static> {
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks(auth));
    fo
}

pub struct GitRepo {
    pub path: PathBuf,
    repo: Repository,
}

impl GitRepo {
    pub fn is_repo(path: &Path) -> bool {
        Repository::open(path).is_ok()
    }

    pub fn open(path: &Path) -> GitResult<Self> {
        Ok(Self { path: path.to_path_buf(), repo: Repository::open(path)? })
    }

    pub fn init(path: &Path, branch: &str) -> GitResult<Self> {
        std::fs::create_dir_all(path)?;
        let mut opts = RepositoryInitOptions::new();
        opts.initial_head(if branch.trim().is_empty() { "main" } else { branch.trim() });
        let repo = Repository::init_opts(path, &opts)?;
        Ok(Self { path: path.to_path_buf(), repo })
    }

    pub fn clone(url: &str, path: &Path, auth: &GitAuth, branch: Option<&str>) -> GitResult<Self> {
        if path.exists() && std::fs::read_dir(path)?.next().is_some() {
            return Err(GitError::Msg(format!("{} is not empty — choose an empty folder to clone into", path.display())));
        }
        let mut builder = RepoBuilder::new();
        builder.fetch_options(fetch_options(auth));
        if let Some(b) = branch.filter(|b| !b.trim().is_empty()) {
            builder.branch(b.trim());
        }
        let repo = builder.clone(url.trim(), path)?;
        Ok(Self { path: path.to_path_buf(), repo })
    }

    pub fn inner(&self) -> &Repository {
        &self.repo
    }

    pub fn current_branch(&self) -> String {
        if let Ok(head) = self.repo.head() {
            if let Some(name) = head.shorthand() {
                return name.to_string();
            }
        }
        // unborn branch: read the symbolic HEAD
        self.repo
            .find_reference("HEAD")
            .ok()
            .and_then(|r| r.symbolic_target().map(|s| s.trim_start_matches("refs/heads/").to_string()))
            .unwrap_or_else(|| "main".into())
    }

    pub fn local_branches(&self) -> GitResult<Vec<String>> {
        let mut out = Vec::new();
        for b in self.repo.branches(Some(BranchType::Local))? {
            let (branch, _) = b?;
            if let Some(name) = branch.name()? {
                out.push(name.to_string());
            }
        }
        Ok(out)
    }

    pub fn remote_branches(&self) -> GitResult<Vec<String>> {
        let mut out = Vec::new();
        for b in self.repo.branches(Some(BranchType::Remote))? {
            let (branch, _) = b?;
            if let Some(name) = branch.name()? {
                if !name.ends_with("/HEAD") {
                    out.push(name.to_string());
                }
            }
        }
        Ok(out)
    }

    pub fn remote_url(&self) -> Option<String> {
        self.repo.find_remote("origin").ok().and_then(|r| r.url().map(str::to_string))
    }

    pub fn set_remote(&self, url: &str) -> GitResult<()> {
        if self.repo.find_remote("origin").is_ok() {
            self.repo.remote_set_url("origin", url.trim())?;
        } else {
            self.repo.remote("origin", url.trim())?;
        }
        Ok(())
    }

    pub fn is_merging(&self) -> bool {
        self.repo.state() == RepositoryState::Merge
    }

    pub fn conflicts(&self) -> GitResult<Vec<String>> {
        let index = self.repo.index()?;
        let mut out = Vec::new();
        if index.has_conflicts() {
            for c in index.conflicts()? {
                let c = c?;
                let entry = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref());
                if let Some(e) = entry {
                    out.push(String::from_utf8_lossy(&e.path).into_owned());
                }
            }
        }
        out.sort();
        out.dedup();
        Ok(out)
    }

    fn upstream_oid(&self, branch: &str) -> Option<Oid> {
        self.repo.refname_to_id(&format!("refs/remotes/origin/{branch}")).ok()
    }

    pub fn status(&self) -> GitResult<RepoStatus> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true).include_ignored(false);
        let statuses = self.repo.statuses(Some(&mut opts))?;
        let mut changed = Vec::new();
        for e in statuses.iter() {
            let s = e.status();
            let path = e.path().unwrap_or("").to_string();
            let status = if s.contains(Status::CONFLICTED) {
                FileStatus::Conflicted
            } else if s.intersects(Status::WT_NEW) {
                FileStatus::Untracked
            } else if s.intersects(Status::INDEX_NEW) {
                FileStatus::Added
            } else if s.intersects(Status::WT_DELETED | Status::INDEX_DELETED) {
                FileStatus::Deleted
            } else if s.intersects(Status::WT_RENAMED | Status::INDEX_RENAMED) {
                FileStatus::Renamed
            } else if s.intersects(Status::WT_MODIFIED | Status::INDEX_MODIFIED | Status::WT_TYPECHANGE | Status::INDEX_TYPECHANGE) {
                FileStatus::Modified
            } else {
                continue;
            };
            changed.push(ChangedFile { path, status });
        }
        let branch = self.current_branch();
        let (mut ahead, mut behind, mut has_upstream) = (0, 0, false);
        if let (Ok(head), Some(up)) = (self.repo.head().and_then(|h| h.peel_to_commit()), self.upstream_oid(&branch)) {
            has_upstream = true;
            if let Ok((a, b)) = self.repo.graph_ahead_behind(head.id(), up) {
                ahead = a;
                behind = b;
            }
        }
        Ok(RepoStatus { branch, changed, ahead, behind, has_upstream, merging: self.is_merging(), conflicts: self.conflicts()? })
    }

    /// Stage everything (including deletions) and commit. Returns None when
    /// there is nothing to commit. Completes an in-progress merge.
    pub fn commit_all(&self, message: &str, author_name: &str, author_email: &str) -> GitResult<Option<Oid>> {
        let mut index = self.repo.index()?;
        // check first: staging a conflicted file would commit conflict markers
        if index.has_conflicts() {
            return Err(GitError::Msg("resolve all conflicts before committing".into()));
        }
        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
        index.update_all(["*"].iter(), None)?;
        index.write()?;
        let tree_id = index.write_tree()?;
        let tree = self.repo.find_tree(tree_id)?;
        let head_commit = self.repo.head().ok().and_then(|h| h.peel_to_commit().ok());
        let merging = self.is_merging();
        if let Some(head) = &head_commit {
            if head.tree_id() == tree_id && !merging {
                return Ok(None);
            }
        }
        let name = if author_name.trim().is_empty() { "Yaak Lite" } else { author_name.trim() };
        let email = if author_email.trim().is_empty() { "yaak-lite@localhost" } else { author_email.trim() };
        let sig = Signature::now(name, email)?;
        let mut parents = Vec::new();
        if let Some(h) = head_commit {
            parents.push(h);
        }
        if merging {
            if let Ok(id) = self.repo.refname_to_id("MERGE_HEAD") {
                parents.push(self.repo.find_commit(id)?);
            }
        }
        let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
        let oid = self.repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parent_refs)?;
        if merging {
            self.repo.cleanup_state()?;
        }
        Ok(Some(oid))
    }

    /// Fetch all branches from origin. Returns (ahead, behind) for `branch`.
    pub fn fetch(&self, auth: &GitAuth, branch: &str) -> GitResult<(usize, usize)> {
        let mut remote = self.repo.find_remote("origin").map_err(|_| GitError::Msg("no remote configured — set a repository URL first".into()))?;
        let mut fo = fetch_options(auth);
        remote.fetch(&["+refs/heads/*:refs/remotes/origin/*"], Some(&mut fo), None)?;
        let head = self.repo.head().ok().and_then(|h| h.target());
        match (head, self.upstream_oid(branch)) {
            (Some(h), Some(u)) => Ok(self.repo.graph_ahead_behind(h, u)?),
            (None, Some(u)) => {
                // unborn local branch: everything upstream is "behind"
                let mut walk = self.repo.revwalk()?;
                walk.push(u)?;
                Ok((0, walk.count()))
            }
            _ => Ok((0, 0)),
        }
    }

    /// Fetch, then fast-forward or merge `origin/<branch>`.
    pub fn pull(&self, auth: &GitAuth, branch: &str, author_name: &str, author_email: &str) -> GitResult<PullOutcome> {
        if self.is_merging() {
            return Err(GitError::Msg("a merge is in progress — resolve or abort it first".into()));
        }
        self.fetch(auth, branch)?;
        let remote_ref = match self.repo.find_reference(&format!("refs/remotes/origin/{branch}")) {
            Ok(r) => r,
            Err(_) => return Ok(PullOutcome::NoRemoteBranch),
        };
        let their = self.repo.reference_to_annotated_commit(&remote_ref)?;
        let (analysis, _) = self.repo.merge_analysis(&[&their])?;
        let local_ref = format!("refs/heads/{branch}");

        if analysis.is_up_to_date() {
            return Ok(PullOutcome::UpToDate);
        }
        if analysis.is_unborn() || analysis.is_fast_forward() {
            let target = self.repo.find_object(their.id(), Some(ObjectType::Commit))?;
            let mut co = CheckoutBuilder::new();
            co.safe();
            // checkout first so a dirty tree aborts before refs move
            self.repo.checkout_tree(&target, Some(&mut co))?;
            match self.repo.find_reference(&local_ref) {
                Ok(mut r) => {
                    r.set_target(their.id(), "yaak-lite: fast-forward")?;
                }
                Err(_) => {
                    self.repo.reference(&local_ref, their.id(), true, "yaak-lite: pull (unborn)")?;
                }
            }
            self.repo.set_head(&local_ref)?;
            return Ok(PullOutcome::FastForward);
        }
        if analysis.is_normal() {
            let mut co = CheckoutBuilder::new();
            co.safe().allow_conflicts(true).conflict_style_merge(true);
            self.repo.merge(&[&their], None, Some(&mut co))?;
            let conflicts = self.conflicts()?;
            if !conflicts.is_empty() {
                return Ok(PullOutcome::Conflicts(conflicts));
            }
            self.commit_all(&format!("Merge remote-tracking branch 'origin/{branch}'"), author_name, author_email)?;
            return Ok(PullOutcome::Merged);
        }
        Err(GitError::Msg("pull is not possible in the current repository state".into()))
    }

    pub fn push(&self, auth: &GitAuth, branch: &str) -> GitResult<()> {
        let mut remote = self.repo.find_remote("origin").map_err(|_| GitError::Msg("no remote configured".into()))?;
        let mut cb = callbacks(auth);
        cb.push_update_reference(|refname, status| match status {
            Some(msg) => Err(git2::Error::from_str(&format!("push rejected for {refname}: {msg} (pull first)"))),
            None => Ok(()),
        });
        let mut po = PushOptions::new();
        po.remote_callbacks(cb);
        let spec = format!("refs/heads/{branch}:refs/heads/{branch}");
        remote.push(&[spec.as_str()], Some(&mut po))?;
        Ok(())
    }

    /// Resolve one conflicted file by taking one side completely.
    pub fn resolve_conflict(&self, path: &str, side: ConflictSide) -> GitResult<()> {
        let mut index = self.repo.index()?;
        let mut chosen: Option<(Oid, u32)> = None;
        let mut found = false;
        for c in index.conflicts()? {
            let c = c?;
            let p = c.our.as_ref().or(c.their.as_ref()).or(c.ancestor.as_ref()).map(|e| String::from_utf8_lossy(&e.path).into_owned());
            if p.as_deref() != Some(path) {
                continue;
            }
            found = true;
            let entry = match side {
                ConflictSide::Ours => c.our,
                ConflictSide::Theirs => c.their,
            };
            chosen = entry.map(|e| (e.id, e.mode));
        }
        if !found {
            return Err(GitError::Msg(format!("{path} is not conflicted")));
        }
        let full = self.path.join(path);
        match chosen {
            Some((oid, _mode)) => {
                let blob = self.repo.find_blob(oid)?;
                if let Some(parent) = full.parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::write(&full, blob.content())?;
                index.add_path(Path::new(path))?;
            }
            None => {
                let _ = std::fs::remove_file(&full);
                index.remove_path(Path::new(path))?;
            }
        }
        index.write()?;
        Ok(())
    }

    /// Abort an in-progress merge and restore HEAD.
    pub fn abort_merge(&self) -> GitResult<()> {
        let head = self.repo.head()?.peel_to_commit()?;
        self.repo.reset(head.as_object(), ResetType::Hard, None)?;
        self.repo.cleanup_state()?;
        Ok(())
    }

    /// Discard local changes and hard-reset to `origin/<branch>`.
    pub fn reset_to_remote(&self, auth: &GitAuth, branch: &str) -> GitResult<()> {
        self.fetch(auth, branch)?;
        let id = self
            .upstream_oid(branch)
            .ok_or_else(|| GitError::Msg(format!("origin/{branch} does not exist")))?;
        let obj = self.repo.find_object(id, Some(ObjectType::Commit))?;
        let local_ref = format!("refs/heads/{branch}");
        self.repo.reference(&local_ref, id, true, "yaak-lite: reset to remote")?;
        self.repo.set_head(&local_ref)?;
        self.repo.reset(&obj, ResetType::Hard, None)?;
        Ok(())
    }

    /// Throw away every uncommitted change: hard-reset to HEAD and delete
    /// untracked files. Aborts an in-progress merge first.
    pub fn discard_local_changes(&self) -> GitResult<()> {
        if self.is_merging() {
            self.abort_merge()?;
        }
        let head = self
            .repo
            .head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|_| GitError::Msg("Nothing has been committed yet — there is no saved state to go back to.".into()))?;
        self.repo.reset(head.as_object(), ResetType::Hard, None)?;
        let root = self.repo.workdir().ok_or_else(|| GitError::Msg("repository has no working tree".into()))?.to_path_buf();
        let mut opts = StatusOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true).include_ignored(false);
        let untracked: Vec<PathBuf> = self
            .repo
            .statuses(Some(&mut opts))?
            .iter()
            .filter(|e| e.status().contains(Status::WT_NEW))
            .filter_map(|e| e.path().map(|p| root.join(p)))
            .collect();
        for path in untracked {
            std::fs::remove_file(&path)?;
        }
        Ok(())
    }

    pub fn checkout_branch(&self, name: &str, create: bool) -> GitResult<()> {
        let local_ref = format!("refs/heads/{name}");
        if self.repo.find_reference(&local_ref).is_err() {
            if let Some(remote_id) = self.upstream_oid(name) {
                let commit = self.repo.find_commit(remote_id)?;
                let mut b = self.repo.branch(name, &commit, false)?;
                let upstream = format!("origin/{name}");
                let _ = b.set_upstream(Some(upstream.as_str()));
            } else if create {
                let head = self.repo.head()?.peel_to_commit()?;
                self.repo.branch(name, &head, false)?;
            } else {
                return Err(GitError::Msg(format!("branch {name} does not exist")));
            }
        }
        let obj = self.repo.revparse_single(&local_ref)?;
        let mut co = CheckoutBuilder::new();
        co.safe();
        self.repo.checkout_tree(&obj, Some(&mut co))?;
        self.repo.set_head(&local_ref)?;
        Ok(())
    }

    pub fn log(&self, limit: usize) -> GitResult<Vec<CommitInfo>> {
        let mut walk = self.repo.revwalk()?;
        if walk.push_head().is_err() {
            return Ok(Vec::new()); // no commits yet
        }
        walk.set_sorting(Sort::TIME)?;
        let mut out = Vec::new();
        for oid in walk.take(limit) {
            let c = self.repo.find_commit(oid?)?;
            out.push(CommitInfo {
                id: c.id().to_string().chars().take(8).collect(),
                summary: c.summary().unwrap_or("").to_string(),
                author: c.author().name().unwrap_or("").to_string(),
                time: c.time().seconds(),
            });
        }
        Ok(out)
    }

    /// Unified diff of everything not yet committed (staged + unstaged + untracked).
    pub fn diff(&self) -> GitResult<String> {
        fn push_line(text: &mut String, line: &git2::DiffLine<'_>) {
            let origin = line.origin();
            if matches!(origin, '+' | '-' | ' ') {
                text.push(origin);
            }
            text.push_str(&String::from_utf8_lossy(line.content()));
        }
        let mut text = String::new();
        if let Ok(head_tree) = self.repo.head().and_then(|h| h.peel_to_tree()) {
            let staged = self.repo.diff_tree_to_index(Some(&head_tree), None, None)?;
            staged.print(DiffFormat::Patch, |_d, _h, l| {
                push_line(&mut text, &l);
                true
            })?;
        }
        let mut opts = DiffOptions::new();
        opts.include_untracked(true).recurse_untracked_dirs(true).show_untracked_content(true);
        let unstaged = self.repo.diff_index_to_workdir(None, Some(&mut opts))?;
        unstaged.print(DiffFormat::Patch, |_d, _h, l| {
            push_line(&mut text, &l);
            true
        })?;
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("zorvilo-git-{name}-{}-{}", std::process::id(), zorvilo_core::ids::now_ms()));
        let _ = std::fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn init_commit_status_log() {
        let dir = tmp("basic");
        let repo = GitRepo::init(&dir, "main").unwrap();
        assert_eq!(repo.current_branch(), "main");
        std::fs::write(dir.join("a.json"), "{}").unwrap();
        let st = repo.status().unwrap();
        assert_eq!(st.changed.len(), 1);
        assert!(repo.commit_all("first", "T", "t@x").unwrap().is_some());
        assert!(repo.commit_all("noop", "T", "t@x").unwrap().is_none());
        std::fs::remove_file(dir.join("a.json")).unwrap();
        assert!(repo.commit_all("delete", "T", "t@x").unwrap().is_some());
        assert_eq!(repo.log(10).unwrap().len(), 2);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn discard_restores_head_and_removes_untracked() {
        let dir = tmp("discard");
        let repo = GitRepo::init(&dir, "main").unwrap();
        assert!(repo.discard_local_changes().is_err()); // nothing committed yet
        std::fs::write(dir.join("a.json"), "1").unwrap();
        repo.commit_all("first", "T", "t@x").unwrap();
        std::fs::write(dir.join("a.json"), "2").unwrap();
        std::fs::create_dir_all(dir.join("new")).unwrap();
        std::fs::write(dir.join("new/b.json"), "x").unwrap();
        repo.discard_local_changes().unwrap();
        assert_eq!(std::fs::read_to_string(dir.join("a.json")).unwrap(), "1");
        assert!(!dir.join("new/b.json").exists());
        assert!(repo.status().unwrap().changed.is_empty());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn clone_pull_push_and_conflict() {
        // bare "remote" + two clones
        let remote = tmp("remote");
        Repository::init_bare(&remote).unwrap();
        let url = remote.to_string_lossy().to_string();
        let auth = GitAuth::default();

        let a_dir = tmp("a");
        let a = GitRepo::init(&a_dir, "main").unwrap();
        a.set_remote(&url).unwrap();
        std::fs::write(a_dir.join("f.json"), "1\n").unwrap();
        a.commit_all("init", "A", "a@x").unwrap();
        a.push(&auth, "main").unwrap();

        let b_dir = tmp("b");
        let b = GitRepo::clone(&url, &b_dir, &auth, Some("main")).unwrap();
        assert_eq!(std::fs::read_to_string(b_dir.join("f.json")).unwrap(), "1\n");

        // fast-forward
        std::fs::write(a_dir.join("f.json"), "2\n").unwrap();
        a.commit_all("two", "A", "a@x").unwrap();
        a.push(&auth, "main").unwrap();
        assert_eq!(b.pull(&auth, "main", "B", "b@x").unwrap(), PullOutcome::FastForward);
        assert_eq!(std::fs::read_to_string(b_dir.join("f.json")).unwrap(), "2\n");

        // diverge → conflict
        std::fs::write(a_dir.join("f.json"), "from-a\n").unwrap();
        a.commit_all("a", "A", "a@x").unwrap();
        a.push(&auth, "main").unwrap();
        std::fs::write(b_dir.join("f.json"), "from-b\n").unwrap();
        b.commit_all("b", "B", "b@x").unwrap();
        match b.pull(&auth, "main", "B", "b@x").unwrap() {
            PullOutcome::Conflicts(files) => assert_eq!(files, vec!["f.json".to_string()]),
            other => panic!("expected conflicts, got {other:?}"),
        }
        b.resolve_conflict("f.json", ConflictSide::Theirs).unwrap();
        b.commit_all("merge", "B", "b@x").unwrap();
        assert!(!b.is_merging());
        assert_eq!(std::fs::read_to_string(b_dir.join("f.json")).unwrap(), "from-a\n");
        b.push(&auth, "main").unwrap();

        for d in [remote, a_dir, b_dir] {
            let _ = std::fs::remove_dir_all(d);
        }
    }
}
