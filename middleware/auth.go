package middleware

import (
	"net/http"

	"github.com/pocketbase/pocketbase/core"
)

const AuthCookieName = "pb_auth"

// AddCookieSessionMiddleware Sets and Reads session data into a secure cookie
func AddCookieSessionMiddleware(app core.App) {
	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		se.Router.BindFunc(loadAuthContextFromCookie(app))
		return se.Next()
	})

	// fires for every auth collection
	app.OnRecordAuthRequest().
		BindFunc(func(e *core.RecordAuthRequestEvent) error {

			if e.Record.IsSuperuser() {
				return e.Next()
			}

			e.SetCookie(&http.Cookie{
				Name:     AuthCookieName,
				Value:    e.Token,
				Path:     "/",
				Secure:   true,
				HttpOnly: true,
			})
			return e.Next()
		})
}

func loadAuthContextFromCookie(
	app core.App,
) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		tokenCookie, err := e.Request.Cookie(AuthCookieName)
		if err != nil || tokenCookie.Value == "" {
			return e.Next() // no token cookie
		}

		token := tokenCookie.Value

		record, err := app.FindAuthRecordByToken(token, core.TokenTypeAuth)
		if err == nil && record != nil {
			e.Auth = record
		}

		return e.Next()
	}
}

func AuthGuard(e *core.RequestEvent) error {
	if e.Auth == nil {
		return e.Redirect(http.StatusFound, "/login")
	}

	return e.Next()
}

func Logout(e *core.RequestEvent) error {
	http.SetCookie(e.Response, &http.Cookie{
		Name:     AuthCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Secure:   true,
		HttpOnly: true,
	})
	return nil
}
