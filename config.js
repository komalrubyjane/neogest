// ESP32 Configuration
const ESP32_CONFIG = {
    // Change this to your ESP32's IP address when in AP mode (usually 192.168.4.1)
    IP_ADDRESS: '192.168.4.1',
    // API endpoints
    ENDPOINTS: {
        STATUS: '/status',        // Status endpoint for connection check
        HEALTH: '/health',        // Health endpoint for device states
        COMMAND: '/command'       // Command endpoint for controlling devices
    }
};

// Export the configuration
window.ESP32_CONFIG = ESP32_CONFIG; 