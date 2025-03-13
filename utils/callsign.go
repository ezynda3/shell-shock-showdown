package utils

import (
	"fmt"
	"math/rand"
	"time"
)

var (
	adjectives = []string{
		"Swift", "Brave", "Mighty", "Rapid", "Fierce", "Sharp", "Noble", "Deadly", "Silent", "Valiant",
		"Savage", "Lethal", "Royal", "Crazy", "Raging", "Brutal", "Iron", "Steel", "Shadow", "Thunder",
		"Desert", "Arctic", "Jungle", "Mountain", "Ocean", "Crimson", "Golden", "Silver", "Phantom", "Emerald",
	}

	nouns = []string{
		"Eagle", "Wolf", "Tiger", "Hawk", "Lion", "Bear", "Shark", "Cobra", "Viper", "Panther",
		"Dragon", "Falcon", "Fox", "Rhino", "Phoenix", "Scorpion", "Hunter", "Ranger", "Knight", "Warrior",
		"Storm", "Ghost", "Blade", "Fist", "Arrow", "Thunder", "Lightning", "Hammer", "Shield", "Dagger",
	}
)

// GenerateCallsign creates a random callsign in the format "<Adjective> <Noun> <4 digit int>"
func GenerateCallsign() string {
	r := rand.New(rand.NewSource(time.Now().UnixNano()))
	
	adj := adjectives[r.Intn(len(adjectives))]
	noun := nouns[r.Intn(len(nouns))]
	number := r.Intn(9000) + 1000 // Ensures a 4-digit number (1000-9999)
	
	return fmt.Sprintf("%s %s %d", adj, noun, number)
}