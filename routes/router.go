package routes

import (
	"context"
	"errors"
	"fmt"

	"github.com/mark3labs/pro-saaskit/game"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// SetupRoutes initializes all routes with NATS, JetStream, and game manager
func SetupRoutes(ctx context.Context, router *router.Router[*core.RequestEvent], nc *nats.Conn, js jetstream.JetStream, gameManager *game.Manager) error {

	err := errors.Join(
		setupIndexRoutes(router, nc, gameManager),
		setupAuthRoutes(router),
	)
	if err != nil {
		return fmt.Errorf("Error: %v", err)
	}

	return nil
}
