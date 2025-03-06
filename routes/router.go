package routes

import (
	"context"
	"errors"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/router"
)

func SetupRoutes(ctx context.Context, router *router.Router[*core.RequestEvent]) error {

	err := errors.Join(
		setupIndexRoutes(router),
		setupAuthRoutes(router),
	)
	if err != nil {
		return fmt.Errorf("Error: %v", err)
	}

	return nil
}
