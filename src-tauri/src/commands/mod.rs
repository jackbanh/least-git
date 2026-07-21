pub mod branches;
pub mod commits;
pub mod config;
pub mod external;
pub mod working_tree;

#[cfg(test)]
pub(crate) mod test_repo;
pub use working_tree::{get_conflict_branch_info, resolve_conflict_local, resolve_conflict_incoming};
