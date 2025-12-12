#!/bin/bash

# Utility script to test Apollo API v2 install-v2 script

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Utility functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if Docker is installed
check_docker() {
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed. Install Docker before continuing."
        exit 1
    fi
    
    if ! command -v docker-compose &> /dev/null; then
        log_error "Docker Compose is not installed. Install Docker Compose before continuing."
        exit 1
    fi
}

# Function for installation testing
test_install() {
    log_info "Testing Apollo installation with install-v2..."
    
    check_docker
    
    # Build and test
    docker-compose up --build
    
    log_info "Test completed. Check logs above for any errors."
}

# Function for test with live logs
test_install_live() {
    log_info "Testing Apollo installation with live logs..."
    
    check_docker
    
    # Build and test with logs
    docker-compose up --build --no-deps apollo-test
}

# Function for container access for debugging
debug_container() {
    log_info "Accessing container for debugging..."
    
    # Check if container exists
    if ! docker ps -a | grep -q "apollo-install-test"; then
        log_error "Container not found. Run first: $0 test"
        exit 1
    fi
    
    docker exec -it apollo-install-test bash
}

# Function to view logs
show_logs() {
    log_info "Viewing test logs..."
    docker-compose logs -f apollo-test
}

# Function for cleanup
cleanup() {
    log_warn "Removing test container..."
    docker-compose down
    docker system prune -f
    log_info "Cleanup completed."
}

# Function for complete rebuild
rebuild() {
    log_info "Complete test rebuild..."
    docker-compose down
    docker-compose build --no-cache
    docker-compose up
}

# Function for manual step-by-step testing
test_manual() {
    log_info "Manual step-by-step installation testing..."
    
    check_docker
    
    # Build image
    docker build -t apollo-test .
    
    log_info "Image built. Starting container for manual testing..."
    log_info "Inside container you can run:"
    log_info "  bash /tmp/test-install.sh"
    log_info "  or specific parts of install-v2 script"
    
    docker run -it --privileged \
      -v /sys/fs/cgroup:/sys/fs/cgroup:ro \
      apollo-test bash
}

# Function to test running services
test_services() {
    log_info "Testing Apollo services..."
    
    # Check if container is running
    if ! docker ps | grep -q "apollo-install-test"; then
        log_error "Container not running. Start it first with: $0 test"
        exit 1
    fi
    
    log_info "Checking service status..."
    docker exec apollo-install-test systemctl status apollo-api apollo-ui-v2 apollo-miner node ckpool --no-pager || true
    
    log_info "Testing API endpoint..."
    if curl -s http://localhost:5003/health > /dev/null; then
        log_info "✓ Apollo API is responding on port 5003"
    else
        log_warn "✗ Apollo API not responding on port 5003"
    fi
    
    log_info "Testing UI endpoint..."
    if curl -s http://localhost:3001 > /dev/null; then
        log_info "✓ Apollo UI is responding on port 3001"
    else
        log_warn "✗ Apollo UI not responding on port 3001"
    fi
}

# Function to check container status
check_status() {
    log_info "Test container status..."
    
    if docker ps -a | grep -q "apollo-install-test"; then
        docker ps -a | grep "apollo-install-test"
        echo ""
        log_info "Recent logs:"
        docker logs apollo-install-test --tail 20
    else
        log_warn "Test container not found."
    fi
}

# Function to show help
show_help() {
    echo "Apollo install-v2 Test Environment - Utility Script"
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Available commands:"
    echo "  test        - Complete install-v2 installation test"
    echo "  test-live   - Test with live logs"
    echo "  test-manual - Manual step-by-step testing"
    echo "  test-services - Test running Apollo services"
    echo "  debug       - Container access for debugging"
    echo "  logs        - Show test logs"
    echo "  status      - Show container status"
    echo "  rebuild     - Complete image rebuild"
    echo "  cleanup     - Complete container removal"
    echo "  help        - Show this help"
    echo ""
    echo "Examples:"
    echo "  $0 test        # Complete test"
    echo "  $0 test-live   # Test with live logs"
    echo "  $0 debug       # Access for debugging"
    echo "  $0 cleanup     # Cleanup"
}

# Main
case "${1:-help}" in
    test)
        test_install
        ;;
    test-live)
        test_install_live
        ;;
    test-manual)
        test_manual
        ;;
    test-services)
        test_services
        ;;
    debug)
        debug_container
        ;;
    logs)
        show_logs
        ;;
    status)
        check_status
        ;;
    rebuild)
        rebuild
        ;;
    cleanup)
        cleanup
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        log_error "Unknown command: $1"
        show_help
        exit 1
        ;;
esac
