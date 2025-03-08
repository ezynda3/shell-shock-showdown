FROM golang:1.24-alpine AS builder
RUN apk update && apk upgrade && apk add --no-cache ca-certificates
RUN update-ca-certificates

# Move to working directory
WORKDIR /app

# Copy and download dependency using go mod
COPY go.mod go.sum ./
RUN go mod download

# Copy your code into the container
COPY . .

# Set necessary environment variables and build your project
ENV CGO_ENABLED=0
RUN go build -o tanks .

# FROM alpine
#
# # Copy project's binary and static files from /build to the scratch container
# COPY --from=builder /build/labbuddy /app/labbuddy
# COPY --from=builder /build/static /app/static
# COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
#
# Expose port
EXPOSE 8090

# Set entry point
ENTRYPOINT ["./tanks", "serve", "--http=0.0.0.0:8090"]
