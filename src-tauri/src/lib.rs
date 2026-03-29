use dashmap::DashMap;
use gix::bstr::ByteSlice;
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Serialize, Clone)]
pub struct TabInfo {
    pub id: String,
    pub path: String,
    pub name: String,
}

#[derive(Serialize, Clone)]
pub struct CommitInfo {
    pub oid: String,
    pub short_oid: String,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
}

struct RepoEntry {
    path: PathBuf,
    name: String,
}

type AppState = DashMap<String, RepoEntry>;

#[tauri::command]
fn open_repo(path: String, state: State<'_, AppState>) -> Result<TabInfo, String> {
    let canonical = PathBuf::from(&path)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let id = canonical.to_string_lossy().to_string();

    if state.contains_key(&id) {
        let entry = state.get(&id).unwrap();
        return Ok(TabInfo {
            id,
            path: entry.path.to_string_lossy().to_string(),
            name: entry.name.clone(),
        });
    }

    // Validate it's a git repo before caching
    gix::open(&canonical).map_err(|e| format!("Not a git repository: {e}"))?;

    let name = canonical
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("repo")
        .to_string();

    state.insert(id.clone(), RepoEntry { path: canonical, name: name.clone() });

    Ok(TabInfo { id: id.clone(), path: id, name })
}

#[tauri::command]
fn close_tab(tab_id: String, state: State<'_, AppState>) {
    state.remove(&tab_id);
}

#[tauri::command]
fn load_commits(
    tab_id: String,
    offset: usize,
    limit: usize,
    state: State<'_, AppState>,
) -> Result<Vec<CommitInfo>, String> {
    let path = {
        let entry = state.get(&tab_id).ok_or_else(|| "Tab not found".to_string())?;
        entry.path.clone()
    };

    let repo = gix::open(&path).map_err(|e| e.to_string())?;
    let head_id = repo.head_id().map_err(|e| e.to_string())?;
    let walk = head_id
        .ancestors()
        .first_parent_only()
        .all()
        .map_err(|e| e.to_string())?;

    let mut commits = Vec::with_capacity(limit.min(100));
    for info in walk.skip(offset).take(limit) {
        let info = info.map_err(|e| e.to_string())?;
        let oid_str = info.id.to_string();
        let short_oid = oid_str[..7].to_string();

        let object = repo.find_object(info.id).map_err(|e| e.to_string())?;
        let commit = object
            .try_into_commit()
            .map_err(|e| format!("not a commit: {e:?}"))?;
        let decoded = commit.decode().map_err(|e| e.to_string())?;

        let end = decoded.message.find_byte(b'\n').unwrap_or(decoded.message.len());
        let summary = decoded.message[..end].to_str_lossy().trim().to_string();

        commits.push(CommitInfo {
            oid: oid_str,
            short_oid,
            summary,
            author_name: decoded.author.name.to_str_lossy().to_string(),
            author_email: decoded.author.email.to_str_lossy().to_string(),
            timestamp: decoded.author.time.seconds,
        });
    }

    Ok(commits)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: AppState = DashMap::new();
    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![open_repo, close_tab, load_commits])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
