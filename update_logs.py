#\!/usr/bin/env python3
import re
import sys

def update_log_statements(file_path):
    # Read the file
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Create a backup
    with open(file_path + '.bak', 'w') as f:
        f.write(content)
    
    # Replace log.Printf with charmbracelet/log functions
    
    # Pattern 1: Error messages with single error
    pattern = r'log\.Printf\("Error ([^:]+): %v", ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Error("Error \1", "error", \2)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern 2: New player joined
    pattern = r'log\.Printf\("New player %s joined\. Setting spawn position at \(%f, %f\)",\s+playerID, posX, posZ\)'
    replacement = r'log.Info("New player joined", "playerID", playerID, "posX", posX, "posZ", posZ)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern 3: Debug messages
    pattern = r'log\.Printf\("Updated player %s at position \(%f, %f, %f\)",\s+playerID,\s+update\.Position\.X,\s+update\.Position\.Y,\s+update\.Position\.Z\)'
    replacement = r'log.Debug("Updated player position", "playerID", playerID, "x", update.Position.X, "y", update.Position.Y, "z", update.Position.Z)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern 4: Rejected shell
    pattern = r'log\.Printf\("Rejected shell firing from player %s: cooldown in effect", playerID\)'
    replacement = r'log.Debug("Rejected shell firing", "playerID", playerID, "reason", "cooldown in effect")'
    content = re.sub(pattern, replacement, content)
    
    # Pattern 5: Added new shell
    pattern = r'log\.Printf\("Added new shell %s from player %s", newShell\.ID, playerID\)'
    replacement = r'log.Debug("Added new shell", "shellID", newShell.ID, "playerID", playerID)'
    content = re.sub(pattern, replacement, content)
    
    # Remove emojis
    emoji_map = {
        "🛑 ": "",
        "🎯 ": "",
        "⚠️ ": "",
        "📊 ": "",
        "🤖 ": "",
        "⚙️ ": "",
        "🔄 ": "",
        "✅ ": "",
        "🚨 ": "",
        "💥 ": ""
    }
    
    for emoji, replacement in emoji_map.items():
        content = content.replace(emoji, replacement)
    
    # Write updated content back to the file
    with open(file_path, 'w') as f:
        f.write(content)
    
    return "Successfully updated log statements"

if __name__ == "__main__":
    file_path = "/home/space_cowboy/Workspace/shell-shock-showdown/game/manager.go"
    print(update_log_statements(file_path))
