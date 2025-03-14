package routes

import (
	"context"
	"errors"
	"fmt"

	"tank-game/game"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// SetupRoutes initializes all routes with game manager
func SetupRoutes(ctx context.Context, router *router.Router[*core.RequestEvent], gameManager *game.Manager) error {

	err := errors.Join(
		setupIndexRoutes(router, gameManager),
		setupAuthRoutes(router),
	)
	if err != nil {
		return fmt.Errorf("Error: %v", err)
	}

	return nil
}
