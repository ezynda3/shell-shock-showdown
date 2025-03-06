package routes

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/mark3labs/pro-saaskit/middleware"
	"github.com/mark3labs/pro-saaskit/views"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/auth"
	"github.com/pocketbase/pocketbase/tools/router"
	"github.com/pocketbase/pocketbase/tools/security"
	"golang.org/x/oauth2"
)

type providerInfo struct {
	Name        string `json:"name"`
	DisplayName string `json:"displayName"`
	State       string `json:"state"`
	AuthURL     string `json:"authURL"`

	// @todo
	// deprecated: use AuthURL instead
	// AuthUrl will be removed after dropping v0.22 support
	AuthUrl string `json:"authUrl"`

	// technically could be omitted if the provider doesn't support PKCE,
	// but to avoid breaking existing typed clients we'll return them as empty string
	CodeVerifier        string `json:"codeVerifier"`
	CodeChallenge       string `json:"codeChallenge"`
	CodeChallengeMethod string `json:"codeChallengeMethod"`
}

func setupAuthRoutes(router *router.Router[*core.RequestEvent]) error {

	router.GET("/login", func(e *core.RequestEvent) error {

		collection, err := e.App.FindCachedCollectionByNameOrId("users")
		if err != nil {
			e.App.Logger().Error(err.Error())
		}

		providers := collection.OAuth2.Providers
		return views.Login(providers).Render(context.Background(), e.Response)
	})

	router.GET("/oauth2-login/{provider}", func(e *core.RequestEvent) error {
		collection, err := e.App.FindCachedCollectionByNameOrId("users")
		if err != nil {
			return err
		}
		config, exists := collection.OAuth2.GetProviderConfig(e.Request.PathValue("provider"))
		if !exists {
			return errors.New("No such provider")
		}

		info, err := getProviderInfo(config, e.App.Settings().Meta.AppURL)
		if err != nil {
			e.App.Logger().Debug(
				err.Error(),
				slog.String("name", config.Name),
				slog.String("error", err.Error()),
			)
			return err
		}

		// Serialize provider info to JSON
		infoJson, err := json.Marshal(info)
		if err != nil {
			return err
		}

		// URL encode the JSON string
		encodedValue := url.QueryEscape(string(infoJson))

		// Set the provider info cookie
		http.SetCookie(e.Response, &http.Cookie{
			Name:     "provider",
			Value:    encodedValue,
			Path:     "/",
			Secure:   true,
			HttpOnly: false,
		})

		return e.Redirect(http.StatusFound, info.AuthURL)
	})

	router.GET("/oauth2-callback", func(e *core.RequestEvent) error {
		return views.OAuth2Callback(e.App).Render(context.Background(), e.Response)
	})

	router.GET("/logout", func(e *core.RequestEvent) error {
		if err := middleware.Logout(e); err != nil {
			return err
		}
		return e.Redirect(http.StatusFound, "/login")
	})

	return nil
}

func getProviderInfo(config core.OAuth2ProviderConfig, appURL string) (providerInfo, error) {
	provider, err := config.InitProvider()
	if err != nil {
		return providerInfo{}, errors.New("Failed to setup OAuth2 provider")
	}

	info := providerInfo{
		Name:        config.Name,
		DisplayName: provider.DisplayName(),
		State:       security.RandomString(30),
	}

	if info.DisplayName == "" {
		info.DisplayName = config.Name
	}

	urlOpts := []oauth2.AuthCodeOption{}

	// custom providers url options
	switch config.Name {
	case auth.NameApple:
		// see https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js/incorporating_sign_in_with_apple_into_other_platforms#3332113
		urlOpts = append(urlOpts, oauth2.SetAuthURLParam("response_mode", "form_post"))
	}

	if provider.PKCE() {
		info.CodeVerifier = security.RandomString(43)
		info.CodeChallenge = security.S256Challenge(info.CodeVerifier)
		info.CodeChallengeMethod = "S256"
		urlOpts = append(urlOpts,
			oauth2.SetAuthURLParam("code_challenge", info.CodeChallenge),
			oauth2.SetAuthURLParam("code_challenge_method", info.CodeChallengeMethod),
		)
	}

	info.AuthURL = provider.BuildAuthURL(
		info.State,
		urlOpts...,
	) + "&redirect_uri=" + appURL + "/oauth2-callback"

	info.AuthUrl = info.AuthURL

	return info, nil
}
