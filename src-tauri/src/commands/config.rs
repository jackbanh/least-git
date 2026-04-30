use crate::git_async;
use std::collections::HashMap;

/// Read multiple `--global` git config keys in one call.
/// Returns a map of key → value string, or null if the key is unset.
#[tauri::command]
pub async fn get_git_config_globals(
    keys: Vec<String>,
) -> Result<HashMap<String, Option<String>>, String> {
    let mut result = HashMap::new();
    for key in &keys {
        let output = git_async()
            .args(["config", "--global", "--get", key])
            .output()
            .await
            .map_err(|e| e.to_string())?;
        let value = if output.status.success() {
            Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
        } else {
            None // key not set
        };
        result.insert(key.clone(), value);
    }
    Ok(result)
}

/// Set or unset a `--global` git config key.
/// Pass `value: null` to unset; otherwise sets the key to the given string.
#[tauri::command]
pub async fn set_git_config_global(key: String, value: Option<String>) -> Result<(), String> {
    let status = match &value {
        Some(val) => git_async()
            .args(["config", "--global", &key, val])
            .status()
            .await
            .map_err(|e| e.to_string())?,
        None => git_async()
            .args(["config", "--global", "--unset", &key])
            .status()
            .await
            .map_err(|e| e.to_string())?,
    };
    if !status.success() {
        // Exit code 5 means the key was already absent — treat as success.
        if status.code() == Some(5) {
            return Ok(());
        }
        return Err(format!("git config exited with code {:?}", status.code()));
    }
    Ok(())
}
