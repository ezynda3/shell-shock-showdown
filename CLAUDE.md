# Shell Shock Showdown Development Guidelines

## Build Commands
- `task build` - Build the entire application
- `task build:templ` - Generate templ templates (note: avoid running during development as hot-reload will handle this)
- `task build:ts` - Build TypeScript files
- `task live` - Start development with hot-reload
- `go test ./... -v` - Run all tests
- `go test ./path/to/package -run TestName` - Run specific test
- `bun install` - Install dependencies

## Code Style

### Go
- Use PascalCase for exported identifiers, camelCase for internal
- Error handling: Always check errors and return them with context
- Return early pattern preferred for error conditions
- Organize imports: std lib, then external, then internal

### TypeScript
- Use camelCase for variables and methods; PascalCase for classes
- 2-space indentation for TypeScript/JS
- Prefer strongly typed code with explicit typing
- Organize class members: properties, constructor, methods

### Project Structure
- Go backend with TypeScript/THREE.js frontend
- Use templ for html templates
- Components should be modular and reusable
- Store shared types in dedicated files
- NATS.io with JetStream and KV is used for game state synchronization
- Event system includes: player updates, shell firing, tank hits, tank deaths, and respawns

### Naming
- Descriptive, consistent naming that indicates purpose
- Avoid abbreviations except for common ones (ID, URL, etc.)
- Test files should follow `filename_test.go` convention