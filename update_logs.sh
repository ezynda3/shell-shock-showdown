#\!/bin/bash

# Backup the file
cp /home/space_cowboy/Workspace/shell-shock-showdown/game/manager.go /home/space_cowboy/Workspace/shell-shock-showdown/game/manager.go.bak

# Function to replace particular log statements
replace_logs() {
  file=$1
  
  # Replace the import statement
  sed -i 's/import (\n\t"context"/import (\n\t"context"/' $file
  
  # Replace log.Printf statements with log.Info or log.Debug
  sed -i 's/log.Printf("New player %s joined. Setting spawn position at (%f, %f)",\n\t\t\tplayerID, posX, posZ)/log.Info("New player joined", \n\t\t\t"playerID", playerID, \n\t\t\t"posX", posX, \n\t\t\t"posZ", posZ)/' $file
  sed -i 's/log.Printf("Error saving game state after player update: %v", err)/log.Error("Error saving game state after player update", "error", err)/' $file
  sed -i 's/log.Printf("Updated player %s at position (%f, %f, %f)",\n\t\tplayerID,\n\t\tupdate.Position.X,\n\t\tupdate.Position.Y,\n\t\tupdate.Position.Z)/log.Debug("Updated player position", \n\t\t"playerID", playerID,\n\t\t"x", update.Position.X,\n\t\t"y", update.Position.Y,\n\t\t"z", update.Position.Z)/' $file
  
  # Add more replacements as needed
}

# Run the replacement
replace_logs "/home/space_cowboy/Workspace/shell-shock-showdown/game/manager.go"
