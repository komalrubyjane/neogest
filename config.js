// ESP32 Configuration
const ESP32_CONFIG = {
    // No direct IP usage, all communication via backend
    ENDPOINTS: {
        STATUS: '/api/device/status',
        CONTROL: '/api/device/control'
    }
};

// Export the configuration
window.ESP32_CONFIG = ESP32_CONFIG;
