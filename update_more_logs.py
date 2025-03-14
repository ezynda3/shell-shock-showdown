#\!/usr/bin/env python3
import re

def update_more_logs(file_path):
    # Read the file
    with open(file_path, 'r') as f:
        content = f.read()
    
    # Pattern: INVALID HIT
    pattern = r'log\.Printf\("INVALID HIT: Tank %s is already destroyed, ignoring hit", ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Debug("Invalid hit on destroyed tank", "targetID", \1)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern: DAMAGE
    pattern = r'log\.Printf\("DAMAGE: Tank %s hit on %s for %d damage by %s",\s+([a-zA-Z0-9_.]+), ([a-zA-Z0-9_.]+), ([a-zA-Z0-9_.]+), ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Debug("Tank hit", "targetID", \1, "location", \2, "damage", \3, "sourceID", \4)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern: EXCESSIVE DAMAGE
    pattern = r'log\.Printf\("EXCESSIVE DAMAGE CAPPED: Reducing %d to 50 for tank %s",\s+([a-zA-Z0-9_.]+), ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Warn("Excessive damage capped", "original", \1, "capped", 50, "targetID", \2)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern: HEALTH UPDATE before
    pattern = r'log\.Printf\("HEALTH UPDATE: Tank %s health before hit: %d", ([a-zA-Z0-9_.]+), ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Debug("Tank health before hit", "targetID", \1, "health", \2)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern: HEALTH UPDATE after
    pattern = r'log\.Printf\("HEALTH UPDATE: Tank %s health after hit: %d", ([a-zA-Z0-9_.]+), ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Debug("Tank health after hit", "targetID", \1, "health", \2)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern: Incremented kill count
    pattern = r'log\.Printf\("Incremented kill count for player %s to %d", ([a-zA-Z0-9_.]+), ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Debug("Incremented kill count", "playerID", \1, "kills", \2)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern: DESTRUCTION
    pattern = r'log\.Printf\("DESTRUCTION: %s", ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Info("Tank destroyed", "message", \1)'
    content = re.sub(pattern, replacement, content)
    
    # Pattern: Target tank not found
    pattern = r'log\.Printf\("Target tank %s not found - creating placeholder entry", ([a-zA-Z0-9_.]+)\)'
    replacement = r'log.Warn("Target tank not found", "targetID", \1, "action", "creating placeholder")'
    content = re.sub(pattern, replacement, content)
    
    # Write updated content back to the file
    with open(file_path, 'w') as f:
        f.write(content)
    
    return "Updated more log statements"

if __name__ == "__main__":
    file_path = "/home/space_cowboy/Workspace/shell-shock-showdown/game/manager.go"
    print(update_more_logs(file_path))
