// Simple notification system to replace alert()
// Shows dismissible messages at the top of the page

const DISMISS_ANIMATION_DURATION = 300; // milliseconds

/**
 * Show a notification message
 * @param {string} message - The message to display
 * @param {string} type - Type of message: 'error', 'success', 'info' (default: 'info')
 * @param {number} autoDismiss - Auto-dismiss after N milliseconds (0 = no auto-dismiss)
 */
export function showMessage(message, type = 'info', autoDismiss = 0) {
    // Get or create notification container
    let container = document.getElementById('notificationContainer');
    if (!container) {
        // Fallback: create container if it doesn't exist (for cached old HTML)
        container = document.createElement('div');
        container.id = 'notificationContainer';
        container.className = 'notification-container';
        document.body.insertBefore(container, document.body.firstChild);
    }

    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;

    // Message text
    const messageEl = document.createElement('span');
    messageEl.className = 'notification-message';
    messageEl.textContent = message;
    notification.appendChild(messageEl);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'notification-close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.setAttribute('tabindex', '0');

    // Click to dismiss
    closeBtn.addEventListener('click', () => {
        dismissNotification(notification);
    });

    // Keyboard support: Enter or Space to dismiss
    closeBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            dismissNotification(notification);
        }
    });

    notification.appendChild(closeBtn);

    // Add to container
    container.appendChild(notification);

    // Trigger animation
    requestAnimationFrame(() => {
        notification.classList.add('notification-visible');
    });

    // Auto-dismiss if specified
    if (autoDismiss > 0) {
        const timeoutId = setTimeout(() => {
            dismissNotification(notification);
        }, autoDismiss);

        // Store timeout ID so we can clear it on manual dismissal
        notification.dataset.timeoutId = timeoutId;
    }
}

/**
 * Dismiss a notification with animation
 * @param {HTMLElement} notification - The notification element to dismiss
 */
function dismissNotification(notification) {
    // Clear auto-dismiss timeout if it exists
    if (notification.dataset.timeoutId) {
        clearTimeout(parseInt(notification.dataset.timeoutId));
        delete notification.dataset.timeoutId;
    }

    notification.classList.remove('notification-visible');
    notification.classList.add('notification-dismissed');

    // Remove from DOM after animation
    setTimeout(() => {
        notification.remove();
    }, DISMISS_ANIMATION_DURATION);
}

/**
 * Convenience function for error messages
 * @param {string} message - The error message to display
 */
export function showError(message) {
    showMessage(message, 'error');
}

/**
 * Convenience function for success messages
 * @param {string} message - The success message to display
 * @param {number} autoDismiss - Auto-dismiss after N milliseconds (default: 3000)
 */
export function showSuccess(message, autoDismiss = 3000) {
    showMessage(message, 'success', autoDismiss);
}

/**
 * Convenience function for info messages
 * @param {string} message - The info message to display
 * @param {number} autoDismiss - Auto-dismiss after N milliseconds (default: 5000)
 */
export function showInfo(message, autoDismiss = 5000) {
    showMessage(message, 'info', autoDismiss);
}
