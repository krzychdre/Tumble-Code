#!/bin/sh
# Tumble Code CLI Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/krzychdre/Tumble-Code/main/apps/cli/install.sh | sh
#
# Environment variables:
#   ROO_INSTALL_DIR   - Installation directory (default: ~/.roo/cli)
#   ROO_BIN_DIR       - Binary symlink directory (default: ~/.local/bin)
#   ROO_VERSION       - Specific version to install (default: latest)
#   ROO_LOCAL_TARBALL - Path to local tarball to install (skips download)
#   ROO_NPM_TIMEOUT   - Seconds before a stalled npm install is killed (default: 180)
#   ROO_CONNECT_TIMEOUT - Seconds to wait while connecting to GitHub or npm (default: 10)

set -e

# Configuration
INSTALL_DIR="${ROO_INSTALL_DIR:-$HOME/.roo/cli}"
BIN_DIR="${ROO_BIN_DIR:-$HOME/.local/bin}"
REPO="krzychdre/Tumble-Code"
MIN_NODE_VERSION=22

# Robustness knobs: every network step is bounded so the installer can never
# stall on an unreachable network, and the dependencies are installed into a
# staging directory so a failed install cannot destroy a working one.
CONNECT_TIMEOUT="${ROO_CONNECT_TIMEOUT:-10}" # seconds per network connection
NPM_TIMEOUT="${ROO_NPM_TIMEOUT:-180}"        # wall-clock budget for one npm install
# Ignore junk in the knobs instead of dying later inside [ ].
case "$NPM_TIMEOUT" in *[!0-9]*|"") NPM_TIMEOUT=180 ;; esac
case "$CONNECT_TIMEOUT" in *[!0-9]*|"") CONNECT_TIMEOUT=10 ;; esac
REGISTRY_REACHABLE=""

# Color output (only if terminal supports it)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m'
else
    RED=''
    GREEN=''
    YELLOW=''
    BLUE=''
    BOLD=''
    NC=''
fi

info() { printf "${GREEN}==>${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}Warning:${NC} %s\n" "$1"; }
error() { printf "${RED}Error:${NC} %s\n" "$1" >&2; exit 1; }

# Run "$@" in the background under a wall-clock budget (first argument,
# seconds). A wedged network - a blackholed connect, a stalled postinstall
# download - gets killed instead of stalling the installer forever. Returns
# 124 on timeout, the command's exit status otherwise, and prints a heartbeat
# so a long install never looks frozen.
run_with_timeout() {
    BUDGET_SECS="$1"
    shift
    "$@" &
    RUN_PID=$!
    RUN_ELAPSED=0
    while kill -0 "$RUN_PID" 2>/dev/null; do
        if [ "$RUN_ELAPSED" -ge "$BUDGET_SECS" ]; then
            kill "$RUN_PID" 2>/dev/null || true
            sleep 1
            kill -9 "$RUN_PID" 2>/dev/null || true
            return 124
        fi
        sleep 1
        RUN_ELAPSED=$((RUN_ELAPSED + 1))
        if [ $((RUN_ELAPSED % 15)) -eq 0 ]; then
            printf "  ...still running (%ss)\n" "$RUN_ELAPSED"
        fi
    done
    if wait "$RUN_PID" 2>/dev/null; then
        return 0
    fi
    return 1
}

# Show the tail of an npm log. npm's output is kept instead of being thrown
# into /dev/null, so a failure points at the real cause.
show_npm_log() {
    if [ -s "$1" ]; then
        warn "Last lines of the npm output:"
        tail -n 15 "$1" 2>/dev/null | sed 's/^/    /'
    fi
}

# Check Node.js version
check_node() {
    if ! command -v node >/dev/null 2>&1; then
        error "Node.js is not installed. Please install Node.js $MIN_NODE_VERSION or higher.

Install Node.js:
  - macOS: brew install node
  - Linux: https://nodejs.org/en/download/package-manager
  - Or use a version manager like fnm, nvm, or mise"
    fi
    
    NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -lt "$MIN_NODE_VERSION" ]; then
        error "Node.js $MIN_NODE_VERSION+ required. Found: $(node -v)

Please upgrade Node.js to version $MIN_NODE_VERSION or higher."
    fi
    
    info "Found Node.js $(node -v)"
}

# npm ships with Node.js but minimal images sometimes omit it; without this
# check the failure would hide behind 2>/dev/null as "Make sure npm is
# available".
check_npm() {
    if ! command -v npm >/dev/null 2>&1; then
        error "npm is not available. It normally ships with Node.js.

Reinstall Node.js $MIN_NODE_VERSION or higher, or install npm manually."
    fi
}

# Detect OS and architecture
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case "$OS" in
        darwin) OS="darwin" ;;
        linux) OS="linux" ;;
        mingw*|msys*|cygwin*) 
            error "Windows is not supported by this installer. Please use WSL or install manually."
            ;;
        *) error "Unsupported OS: $OS" ;;
    esac
    
    case "$ARCH" in
        x86_64|amd64) ARCH="x64" ;;
        arm64|aarch64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    PLATFORM="${OS}-${ARCH}"
    info "Detected platform: $PLATFORM"
}

# Get latest release version or use specified version
get_version() {
    # Skip version fetch if using local tarball
    if [ -n "$ROO_LOCAL_TARBALL" ]; then
        VERSION="${ROO_VERSION:-local}"
        info "Using local tarball (version: $VERSION)"
        return
    fi
    
    if [ -n "$ROO_VERSION" ]; then
        VERSION="$ROO_VERSION"
        info "Using specified version: $VERSION"
        return
    fi
    
    info "Fetching latest version..."
    
    # Try to get the latest cli release
    RELEASES_JSON=$(curl -fsSL --connect-timeout "$CONNECT_TIMEOUT" "https://api.github.com/repos/$REPO/releases" 2>/dev/null) || {
        error "Failed to fetch releases from GitHub. Check your internet connection."
    }
    
    # Extract highest cli-v* tag by semantic version (do not rely on API ordering)
    VERSION=$(printf "%s" "$RELEASES_JSON" | node -e '
const fs = require("fs")
const input = fs.readFileSync(0, "utf8")
let releases
try {
  releases = JSON.parse(input)
} catch {
  process.exit(1)
}

function parseVersion(version) {
  const core = String(version).trim().split("+", 1)[0].split("-", 1)[0]
  if (!core) return null
  const parts = core.split(".")
  if (parts.length === 0 || parts.some((part) => !/^\d+$/.test(part))) {
    return null
  }
  return parts.map((part) => Number.parseInt(part, 10))
}

function compareVersions(a, b) {
  const maxLength = Math.max(a.length, b.length)
  for (let i = 0; i < maxLength; i++) {
    const aPart = a[i] ?? 0
    const bPart = b[i] ?? 0
    if (aPart > bPart) return 1
    if (aPart < bPart) return -1
  }
  return 0
}

let latestVersion = ""
let latestParts = null

if (Array.isArray(releases)) {
  for (const release of releases) {
    if (!release || typeof release.tag_name !== "string" || !release.tag_name.startsWith("cli-v")) {
      continue
    }
    const candidate = release.tag_name.slice("cli-v".length)
    const candidateParts = parseVersion(candidate)
    if (!candidateParts) continue
    if (!latestParts || compareVersions(candidateParts, latestParts) > 0) {
      latestVersion = candidate
      latestParts = candidateParts
    }
  }
}

if (latestVersion) {
  process.stdout.write(latestVersion)
}
')
    
    if [ -z "$VERSION" ]; then
        error "Could not find any CLI releases. The CLI may not have been released yet."
    fi
    
    info "Latest version: $VERSION"
}

# Probe the npm registry through npm itself, so the user's mirror and proxy
# settings apply, under a hard timeout: an unreachable network is detected in
# seconds instead of surfacing as npm's multi-minute retry stall.
check_registry() {
    info "Checking npm registry reachability..."
    NPM_PING_LOG="$TMP_DIR/npm-ping.log"
    PING_STATUS=0
    run_with_timeout $((CONNECT_TIMEOUT + 5)) sh -c 'exec npm ping --fetch-retries=0 --fetch-timeout="$1" >>"$2" 2>&1' sh "$((CONNECT_TIMEOUT * 1000))" "$NPM_PING_LOG" || PING_STATUS=$?
    if [ "$PING_STATUS" -eq 0 ]; then
        REGISTRY_REACHABLE=1
        return 0
    fi
    REGISTRY_REACHABLE=""
    if [ "$PING_STATUS" -eq 124 ]; then
        warn "npm registry did not answer within $((CONNECT_TIMEOUT + 5))s."
    else
        warn "npm registry not reachable:"
        tail -n 3 "$NPM_PING_LOG" 2>/dev/null | sed 's/^/    /'
    fi
}

# Report a stalled dependency install: show what npm managed to say, then stop.
npm_install_timed_out() {
    show_npm_log "$1"
    error "Installing dependencies timed out after ${NPM_TIMEOUT}s and npm was terminated.

This is almost always a network problem (offline machine, captive portal,
blackholed VPN). Check your connection and run the installer again, or raise
the budget with ROO_NPM_TIMEOUT=<seconds> if your network is just slow."
}

# Install the release's external dependencies into $1 (a staging directory),
# appending npm's output to $2. Every attempt is bounded by run_with_timeout
# so neither an offline machine nor a wedged network can stall the installer:
#   - registry unreachable -> first a cache-only --offline attempt (it cannot
#     stall), then bounded registry attempts in case the ping was a false
#     alarm - the tarball download usually succeeded moments earlier
#   - install stalled      -> killed after $NPM_TIMEOUT seconds
#   - any failure          -> npm's own output is shown, not discarded
install_dependencies() {
    TARGET_DIR="$1"
    NPM_LOG="$2"

    # npm runs through sh -c so its output goes to the log while the
    # run_with_timeout heartbeat stays on the terminal; extra arguments become
    # extra npm flags.
    run_npm_install() {
        run_with_timeout "$NPM_TIMEOUT" sh -c 'cd "$1" || exit 1; log="$2"; shift 2; exec npm install --omit=dev --no-audit --no-fund --loglevel=warn "$@" >>"$log" 2>&1' sh "$TARGET_DIR" "$NPM_LOG" "$@"
    }

    if [ -z "$REGISTRY_REACHABLE" ]; then
        warn "npm registry unreachable - installing from the local npm cache only..."
        OFFLINE_STATUS=0
        run_npm_install --offline || OFFLINE_STATUS=$?
        if [ "$OFFLINE_STATUS" -eq 0 ]; then
            info "Dependencies restored from the npm cache."
            return 0
        fi
        if [ "$OFFLINE_STATUS" -eq 124 ]; then
            npm_install_timed_out "$NPM_LOG"
        fi
        show_npm_log "$NPM_LOG"
        warn "The npm cache is not enough - trying the registry anyway..."
    fi

    info "Installing dependencies..."
    INSTALL_STATUS=0
    run_npm_install --prefer-offline || INSTALL_STATUS=$?
    if [ "$INSTALL_STATUS" -eq 124 ]; then
        npm_install_timed_out "$NPM_LOG"
    fi
    if [ "$INSTALL_STATUS" -ne 0 ]; then
        warn "npm install failed, trying again with --legacy-peer-deps..."
        INSTALL_STATUS=0
        run_npm_install --prefer-offline --legacy-peer-deps || INSTALL_STATUS=$?
        if [ "$INSTALL_STATUS" -eq 124 ]; then
            npm_install_timed_out "$NPM_LOG"
        fi
        if [ "$INSTALL_STATUS" -ne 0 ]; then
            show_npm_log "$NPM_LOG"
            error "Failed to install dependencies.

If this machine is offline or behind a proxy, fix the network first and run
the installer again. A previous installation, if any, is left untouched."
        fi
    fi
}

# Download and extract
download_and_install() {
    TARBALL="tumble-cli-${PLATFORM}.tar.gz"
    
    # Create temp directory
    TMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TMP_DIR"' EXIT
    
    # Use local tarball if provided, otherwise download
    if [ -n "$ROO_LOCAL_TARBALL" ]; then
        if [ ! -f "$ROO_LOCAL_TARBALL" ]; then
            error "Local tarball not found: $ROO_LOCAL_TARBALL"
        fi
        info "Using local tarball: $ROO_LOCAL_TARBALL"
        cp "$ROO_LOCAL_TARBALL" "$TMP_DIR/$TARBALL"
    else
        URL="https://github.com/$REPO/releases/download/cli-v${VERSION}/${TARBALL}"

        info "Downloading from $URL..."

        # Download with progress indicator, bounded so an unreachable network
        # fails with a message instead of hanging the installer.
        HTTP_CODE=$(curl -fsSL --connect-timeout "$CONNECT_TIMEOUT" --speed-time 60 --speed-limit 10 -w "%{http_code}" "$URL" -o "$TMP_DIR/$TARBALL" 2>"$TMP_DIR/curl-download.log") || {
            if [ "$HTTP_CODE" = "404" ]; then
                error "Release not found for platform $PLATFORM version $VERSION.

Available at: https://github.com/$REPO/releases"
            fi
            CURL_TIP=$(tail -n 1 "$TMP_DIR/curl-download.log" 2>/dev/null)
            error "Download failed${CURL_TIP:+: $CURL_TIP}

Check your internet connection and run the installer again."
        }

        # Verify we got something
        if [ ! -s "$TMP_DIR/$TARBALL" ]; then
            error "Downloaded file is empty. Please try again."
        fi
    fi

    # Extract into a staging directory and replace the installation only after
    # the dependencies are installed: a failed or offline install then leaves
    # any previous working installation untouched.
    STAGING_DIR="$TMP_DIR/staging"
    mkdir -p "$STAGING_DIR"

    info "Extracting..."
    tar -xzf "$TMP_DIR/$TARBALL" -C "$STAGING_DIR" --strip-components=1 || {
        error "Failed to extract tarball. The download may be corrupted."
    }

    # Save ripgrep binary before npm install (npm install will overwrite node_modules)
    RIPGREP_BIN=""
    if [ -f "$STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg" ]; then
        RIPGREP_BIN="$TMP_DIR/rg"
        cp "$STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg" "$RIPGREP_BIN"
    fi

    # Probe the network before installing so an offline machine fails fast
    # with clear guidance instead of stalling in npm's retry loop.
    check_registry

    # Install npm dependencies; bounded so a wedged network cannot stall us
    NPM_LOG="$TMP_DIR/npm-install.log"
    install_dependencies "$STAGING_DIR" "$NPM_LOG"

    # Restore ripgrep binary after npm install
    if [ -n "$RIPGREP_BIN" ] && [ -f "$RIPGREP_BIN" ]; then
        mkdir -p "$STAGING_DIR/node_modules/@vscode/ripgrep/bin"
        cp "$RIPGREP_BIN" "$STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg"
        chmod +x "$STAGING_DIR/node_modules/@vscode/ripgrep/bin/rg"
    fi

    # Make executable
    chmod +x "$STAGING_DIR/bin/tumble"

    # Also make ripgrep executable if it exists
    if [ -f "$STAGING_DIR/bin/rg" ]; then
        chmod +x "$STAGING_DIR/bin/rg"
    fi

    # Swap the staged install into place; every failure above left the
    # previous installation intact.
    if [ -e "$INSTALL_DIR" ]; then
        info "Replacing previous installation..."
        rm -rf "$INSTALL_DIR"
    fi
    mkdir -p "$(dirname "$INSTALL_DIR")"
    mv "$STAGING_DIR" "$INSTALL_DIR"
}

# Create symlink in bin directory
setup_bin() {
    mkdir -p "$BIN_DIR"
    
    # Remove old symlink if exists
    if [ -L "$BIN_DIR/tumble" ] || [ -f "$BIN_DIR/tumble" ]; then
        rm -f "$BIN_DIR/tumble"
    fi
    
    ln -sf "$INSTALL_DIR/bin/tumble" "$BIN_DIR/tumble"
    info "Created symlink: $BIN_DIR/tumble"
}

# Check if bin dir is in PATH and provide instructions
check_path() {
    case ":$PATH:" in
        *":$BIN_DIR:"*) 
            # Already in PATH
            return 0
            ;;
    esac
    
    warn "$BIN_DIR is not in your PATH"
    echo ""
    echo "Add this line to your shell profile:"
    echo ""
    
    # Detect shell and provide specific instructions
    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
        zsh)
            echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.zshrc"
            echo "  source ~/.zshrc"
            ;;
        bash)
            if [ -f "$HOME/.bashrc" ]; then
                echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bashrc"
                echo "  source ~/.bashrc"
            else
                echo "  echo 'export PATH=\"$BIN_DIR:\$PATH\"' >> ~/.bash_profile"
                echo "  source ~/.bash_profile"
            fi
            ;;
        fish)
            echo "  set -Ux fish_user_paths $BIN_DIR \$fish_user_paths"
            ;;
        *)
            echo "  export PATH=\"$BIN_DIR:\$PATH\""
            ;;
    esac
    echo ""
}

# Verify installation
verify_install() {
    if [ -x "$BIN_DIR/tumble" ]; then
        info "Verifying installation..."
        # Just check if it runs without error
        "$BIN_DIR/tumble" --version >/dev/null 2>&1 || true
    fi
}

# Print success message
print_success() {
    echo ""
    printf "${GREEN}${BOLD}✓ Tumble Code CLI installed successfully!${NC}\n"
    echo ""
    echo "  Installation: $INSTALL_DIR"
    echo "  Binary: $BIN_DIR/tumble"
    echo "  Version: $VERSION"
    echo ""
    echo "  ${BOLD}Get started:${NC}"
    echo "    tumble --help"
    echo ""
    echo "  ${BOLD}Example:${NC}"
    echo "    export OPENROUTER_API_KEY=sk-or-v1-..."
    echo "    cd ~/my-project && tumble \"What is this project?\""
    echo ""
}

# Main
main() {
    echo ""
    printf "${BLUE}${BOLD}"
    echo "  ╭─────────────────────────────────╮"
    echo "  │    Tumble Code CLI Installer    │"
    echo "  ╰─────────────────────────────────╯"
    printf "${NC}"
    echo ""
    
    check_node
    check_npm
    detect_platform
    get_version
    download_and_install
    setup_bin
    check_path
    verify_install
    print_success
}

main "$@"
