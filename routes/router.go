package routes

import (
	"context"
	"errors"
	"fmt"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

// SetupRoutes initializes all routes with NATS, JetStream, and KV
func SetupRoutes(ctx context.Context, router *router.Router[*core.RequestEvent], nc *nats.Conn, js jetstream.JetStream, kv jetstream.KeyValue) error {

	err := errors.Join(
		setupIndexRoutes(router, nc, js, kv),
		setupAuthRoutes(router),
	)
	if err != nil {
		return fmt.Errorf("Error: %v", err)
	}

	return nil
}
