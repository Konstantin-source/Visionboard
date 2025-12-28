/**
 * VISIONBOARD - Main Application
 * Clean architecture with backend sync and infinite canvas
 */

// Auth token management
let authToken = localStorage.getItem('visionboard_token') || null;

function getAuthHeaders() {
    return authToken ? { 'X-Auth-Token': authToken } : {};
}

// Login handling
async function handleLogin(e) {
    e.preventDefault();
    const password = document.getElementById('loginPassword').value;
    const errorEl = document.getElementById('loginError');
    
    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        
        if (res.ok) {
            const data = await res.json();
            authToken = data.token;
            localStorage.setItem('visionboard_token', authToken);
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('appContainer').classList.remove('hidden');
            window.visionboard = new VisionboardApp();
        } else {
            errorEl.classList.remove('hidden');
            document.getElementById('loginPassword').value = '';
        }
    } catch (err) {
        errorEl.textContent = 'Verbindungsfehler';
        errorEl.classList.remove('hidden');
    }
}

// Check existing session on page load
async function checkAuth() {
    if (!authToken) {
        document.getElementById('loginScreen').classList.remove('hidden');
        return;
    }
    
    try {
        const res = await fetch('/api/auth/check', {
            headers: getAuthHeaders()
        });
        const data = await res.json();
        
        if (data.authenticated) {
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('appContainer').classList.remove('hidden');
            window.visionboard = new VisionboardApp();
        } else {
            localStorage.removeItem('visionboard_token');
            authToken = null;
            document.getElementById('loginScreen').classList.remove('hidden');
        }
    } catch (err) {
        document.getElementById('loginScreen').classList.remove('hidden');
    }
}

// Initialize login form
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('loginForm').addEventListener('submit', handleLogin);
    checkAuth();
});

class VisionboardApp {
    constructor() {
        // DOM Elements
        this.viewport = document.getElementById('canvasViewport');
        this.canvas = document.getElementById('visionCanvas');
        this.contextMenu = document.getElementById('contextMenu');
        this.minimap = document.getElementById('minimap');
        this.minimapViewport = document.getElementById('minimapViewport');
        
        // State
        this.boardId = 'default';
        this.items = [];
        this.todos = [];
        
        // Canvas state (5000x5000 canvas)
        this.canvasSize = 5000;
        this.viewport_x = this.canvasSize / 2 - window.innerWidth / 2;
        this.viewport_y = this.canvasSize / 2 - window.innerHeight / 2;
        this.zoom = 1;
        this.minZoom = 0.25;
        this.maxZoom = 2;
        
        // Interaction state
        this.isPanning = false;
        this.isSpacePressed = false;
        this.panStart = { x: 0, y: 0 };
        this.selectedItem = null;
        this.draggedItem = null;
        this.dragOffset = { x: 0, y: 0 };
        this.resizingItem = null;
        this.resizeStart = { x: 0, y: 0, width: 0, height: 0 };
        this.editingItemId = null;
        
        // Context menu state
        this.contextMenuPosition = { x: 0, y: 0 };
        
        // Keyboard navigation state
        this.keysPressed = new Set();
        this.navigationSpeed = 8; // Pixels per frame
        this.navigationSpeedFast = 25; // Pixels per frame when holding Shift
        this.isNavigating = false;
        this.isShiftPressed = false;
        
        // Text editor state
        this.textEditorState = {
            fontSize: 24,
            color: '#ffffff',
            bold: false,
            italic: false,
            glow: false
        };
        
        // Todo editor state
        this.todoEditorState = {
            priority: 'medium'
        };
        
        // API base URL
        this.apiBase = this.detectApiBase();
        
        // Sync state
        this.syncStatus = document.getElementById('syncStatus');
        this.pendingSync = false;
        this.syncTimeout = null;
        
        this.init();
    }
    
    detectApiBase() {
        // When running via Docker with nginx proxy, use relative path
        // When running locally, try localhost:3001
        if (window.location.port === '8080' || window.location.port === '80' || window.location.port === '') {
            return '/api'; // Use nginx proxy
        }
        return `http://localhost:3001/api`;
    }
    
    async init() {
        await this.loadFromServer();
        this.bindEvents();
        this.render();
        this.renderTodos();
        this.updateViewport();
        this.updateMinimap();
        this.updateZoomDisplay();
    }
    
    // ========================================
    // Event Bindings
    // ========================================
    
    bindEvents() {
        // Tab Navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.currentTarget.dataset.tab));
        });
        
        // Header actions
        document.getElementById('resetView').addEventListener('click', () => this.resetView());
        
        // Close shortcuts hint
        document.getElementById('closeHint')?.addEventListener('click', () => {
            document.getElementById('shortcutsHint').classList.add('hidden');
        });
        
        // Viewport - Pan & Zoom
        this.viewport.addEventListener('mousedown', (e) => this.onViewportMouseDown(e));
        this.viewport.addEventListener('mousemove', (e) => this.onViewportMouseMove(e));
        this.viewport.addEventListener('mouseup', (e) => this.onViewportMouseUp(e));
        this.viewport.addEventListener('mouseleave', (e) => this.onViewportMouseUp(e));
        this.viewport.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
        
        // Touch events for mobile
        this.viewport.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
        this.viewport.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
        this.viewport.addEventListener('touchend', (e) => this.onTouchEnd(e));
        
        // Context menu on canvas click
        this.canvas.addEventListener('click', (e) => this.onCanvasClick(e));
        this.canvas.addEventListener('contextmenu', (e) => this.onCanvasRightClick(e));
        
        // Context menu buttons
        document.querySelectorAll('.context-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.onContextMenuAction(e.currentTarget.dataset.action));
        });
        
        // Close context menu on click elsewhere
        document.addEventListener('click', (e) => {
            if (!this.contextMenu.contains(e.target) && !e.target.closest('.canvas-item')) {
                this.hideContextMenu();
            }
        });
        
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => this.onKeyDown(e));
        document.addEventListener('keyup', (e) => this.onKeyUp(e));
        
        // Paste anywhere
        document.addEventListener('paste', (e) => this.onPaste(e));
        
        // Zoom controls
        document.getElementById('zoomIn').addEventListener('click', () => this.zoomIn());
        document.getElementById('zoomOut').addEventListener('click', () => this.zoomOut());
        
        // Minimap click
        this.minimap.addEventListener('click', (e) => this.onMinimapClick(e));
        
        // Image input
        document.getElementById('imageInput').addEventListener('change', (e) => this.handleImageSelect(e));
        
        // Text Editor Modal
        document.getElementById('closeTextEditor').addEventListener('click', () => this.closeTextEditor());
        document.getElementById('cancelText').addEventListener('click', () => this.closeTextEditor());
        document.getElementById('saveText').addEventListener('click', () => this.saveTextItem());
        
        // Font size slider
        const fontSizeSlider = document.getElementById('fontSize');
        fontSizeSlider.addEventListener('input', (e) => {
            this.textEditorState.fontSize = parseInt(e.target.value);
            document.getElementById('fontSizeValue').textContent = `${e.target.value}px`;
        });
        
        // Color picker
        document.querySelectorAll('.color-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.textEditorState.color = e.currentTarget.dataset.color;
            });
        });
        
        // Style buttons
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const style = e.currentTarget.dataset.style;
                e.currentTarget.classList.toggle('active');
                this.textEditorState[style] = e.currentTarget.classList.contains('active');
            });
        });
        
        // Todo Editor Modal
        document.getElementById('addTodo').addEventListener('click', () => this.openTodoEditor());
        document.getElementById('closeTodoEditor').addEventListener('click', () => this.closeTodoEditor());
        document.getElementById('cancelTodo').addEventListener('click', () => this.closeTodoEditor());
        document.getElementById('saveTodo').addEventListener('click', () => this.saveTodoItem());
        
        // Priority picker
        document.querySelectorAll('.priority-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.priority-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.todoEditorState.priority = e.currentTarget.dataset.priority;
            });
        });
        
        // Enter key in todo input
        document.getElementById('todoTitle').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.saveTodoItem();
        });
        
        // Drag & Drop files
        this.viewport.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.viewport.classList.add('dragover');
        });
        this.viewport.addEventListener('dragleave', () => {
            this.viewport.classList.remove('dragover');
        });
        this.viewport.addEventListener('drop', (e) => this.onDrop(e));
        
        // Mobile Joystick
        this.initMobileJoystick();
        
        // Mobile FABs
        this.initMobileFABs();
        
        // Save before leaving
        window.addEventListener('beforeunload', () => this.syncToServer());
    }
    
    // ========================================
    // Mobile Joystick
    // ========================================
    
    initMobileJoystick() {
        const joystick = document.getElementById('mobileJoystick');
        const stick = document.getElementById('joystickStick');
        
        if (!joystick || !stick) return;
        
        this.joystickState = {
            active: false,
            startX: 0,
            startY: 0,
            currentX: 0,
            currentY: 0,
            maxDistance: 35 // Maximum distance the stick can move from center
        };
        
        // Touch events for joystick
        stick.addEventListener('touchstart', (e) => this.onJoystickStart(e), { passive: false });
        document.addEventListener('touchmove', (e) => this.onJoystickMove(e), { passive: false });
        document.addEventListener('touchend', (e) => this.onJoystickEnd(e));
        
        // Also support mouse for testing
        stick.addEventListener('mousedown', (e) => this.onJoystickMouseStart(e));
        document.addEventListener('mousemove', (e) => this.onJoystickMouseMove(e));
        document.addEventListener('mouseup', (e) => this.onJoystickMouseEnd(e));
    }
    
    onJoystickStart(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const touch = e.touches[0];
        const stick = document.getElementById('joystickStick');
        const rect = stick.getBoundingClientRect();
        
        this.joystickState.active = true;
        this.joystickState.startX = rect.left + rect.width / 2;
        this.joystickState.startY = rect.top + rect.height / 2;
        this.joystickState.touchId = touch.identifier;
        
        stick.classList.add('active');
        this.startJoystickNavigation();
    }
    
    onJoystickMove(e) {
        if (!this.joystickState.active) return;
        
        // Find the correct touch
        let touch = null;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === this.joystickState.touchId) {
                touch = e.touches[i];
                break;
            }
        }
        
        if (!touch) return;
        e.preventDefault();
        
        this.updateJoystickPosition(touch.clientX, touch.clientY);
    }
    
    onJoystickEnd(e) {
        if (!this.joystickState.active) return;
        
        // Check if our touch ended
        let touchEnded = true;
        for (let i = 0; i < e.touches.length; i++) {
            if (e.touches[i].identifier === this.joystickState.touchId) {
                touchEnded = false;
                break;
            }
        }
        
        if (touchEnded) {
            this.resetJoystick();
        }
    }
    
    onJoystickMouseStart(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const stick = document.getElementById('joystickStick');
        const rect = stick.getBoundingClientRect();
        
        this.joystickState.active = true;
        this.joystickState.startX = rect.left + rect.width / 2;
        this.joystickState.startY = rect.top + rect.height / 2;
        this.joystickState.mouseDown = true;
        
        stick.classList.add('active');
        this.startJoystickNavigation();
    }
    
    onJoystickMouseMove(e) {
        if (!this.joystickState.active || !this.joystickState.mouseDown) return;
        this.updateJoystickPosition(e.clientX, e.clientY);
    }
    
    onJoystickMouseEnd(e) {
        if (this.joystickState.mouseDown) {
            this.joystickState.mouseDown = false;
            this.resetJoystick();
        }
    }
    
    updateJoystickPosition(clientX, clientY) {
        const stick = document.getElementById('joystickStick');
        const maxDist = this.joystickState.maxDistance;
        
        let dx = clientX - this.joystickState.startX;
        let dy = clientY - this.joystickState.startY;
        
        // Calculate distance and clamp
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > maxDist) {
            dx = (dx / distance) * maxDist;
            dy = (dy / distance) * maxDist;
        }
        
        // Update stick position
        stick.style.transform = `translate(${dx}px, ${dy}px)`;
        
        // Store normalized direction (-1 to 1)
        this.joystickState.currentX = dx / maxDist;
        this.joystickState.currentY = dy / maxDist;
    }
    
    resetJoystick() {
        const stick = document.getElementById('joystickStick');
        
        this.joystickState.active = false;
        this.joystickState.currentX = 0;
        this.joystickState.currentY = 0;
        
        stick.style.transform = 'translate(0, 0)';
        stick.classList.remove('active');
        
        this.stopJoystickNavigation();
    }
    
    startJoystickNavigation() {
        if (this.joystickNavigating) return;
        this.joystickNavigating = true;
        this.joystickNavigationLoop();
    }
    
    stopJoystickNavigation() {
        this.joystickNavigating = false;
        this.saveViewportPosition();
    }
    
    joystickNavigationLoop() {
        if (!this.joystickNavigating) return;
        
        const speed = 12; // Base speed
        const dx = this.joystickState.currentX;
        const dy = this.joystickState.currentY;
        
        if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
            this.viewport_x += dx * speed;
            this.viewport_y += dy * speed;
            
            this.clampViewport();
            this.updateViewport();
            this.updateMinimap();
        }
        
        requestAnimationFrame(() => this.joystickNavigationLoop());
    }
    
    // ========================================
    // Mobile Floating Action Buttons
    // ========================================
    
    initMobileFABs() {
        const fabContainer = document.getElementById('mobileFabContainer');
        const fabMain = document.getElementById('mobileFabMain');
        const fabText = document.getElementById('mobileFabText');
        const fabImage = document.getElementById('mobileFabImage');
        const fabCenter = document.getElementById('mobileFabCenter');
        
        if (!fabContainer || !fabMain) return;
        
        // Toggle FAB menu
        fabMain.addEventListener('click', (e) => {
            e.stopPropagation();
            fabContainer.classList.toggle('open');
        });
        
        // Close FAB menu when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!fabContainer.contains(e.target)) {
                fabContainer.classList.remove('open');
            }
        });
        
        // Text action
        if (fabText) {
            fabText.addEventListener('click', (e) => {
                e.stopPropagation();
                fabContainer.classList.remove('open');
                this.openTextEditorAtCenter();
            });
        }
        
        // Image action
        if (fabImage) {
            fabImage.addEventListener('click', (e) => {
                e.stopPropagation();
                fabContainer.classList.remove('open');
                this.triggerImageUpload();
            });
        }
        
        // Center/Reset action
        if (fabCenter) {
            fabCenter.addEventListener('click', (e) => {
                e.stopPropagation();
                fabContainer.classList.remove('open');
                this.resetView();
            });
        }
    }
    
    // ========================================
    // Tab Navigation
    // ========================================
    
    switchTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tab}-tab`);
        });
        this.hideContextMenu();
    }
    
    // ========================================
    // Viewport / Pan & Zoom
    // ========================================
    
    onViewportMouseDown(e) {
        if (e.target.closest('.canvas-item')) return;
        
        // Middle mouse or space + click for panning
        if (e.button === 1 || this.isSpacePressed) {
            e.preventDefault();
            this.startPan(e.clientX, e.clientY);
        }
    }
    
    onViewportMouseMove(e) {
        if (this.isPanning) {
            this.doPan(e.clientX, e.clientY);
        } else if (this.draggedItem) {
            this.doDragItem(e.clientX, e.clientY);
        } else if (this.resizingItem) {
            this.doResize(e.clientX, e.clientY);
        }
    }
    
    onViewportMouseUp(e) {
        if (this.isPanning) {
            this.endPan();
        }
        if (this.draggedItem) {
            this.endDragItem();
        }
        if (this.resizingItem) {
            this.endResize();
        }
    }
    
    startPan(x, y) {
        this.isPanning = true;
        this.panStart = { x, y };
        this.viewport.classList.add('grabbing');
    }
    
    doPan(x, y) {
        const dx = x - this.panStart.x;
        const dy = y - this.panStart.y;
        this.viewport_x -= dx / this.zoom;
        this.viewport_y -= dy / this.zoom;
        this.panStart = { x, y };
        this.clampViewport();
        this.updateViewport();
        this.updateMinimap();
    }
    
    endPan() {
        this.isPanning = false;
        this.viewport.classList.remove('grabbing');
        this.scheduleSyncViewport();
    }
    
    onWheel(e) {
        e.preventDefault();
        const rect = this.viewport.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Get position on canvas before zoom
        const canvasX = this.viewport_x + mouseX / this.zoom;
        const canvasY = this.viewport_y + mouseY / this.zoom;
        
        // Calculate new zoom
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * delta));
        
        if (newZoom !== this.zoom) {
            this.zoom = newZoom;
            
            // Adjust viewport to keep mouse position fixed
            this.viewport_x = canvasX - mouseX / this.zoom;
            this.viewport_y = canvasY - mouseY / this.zoom;
            
            this.clampViewport();
            this.updateViewport();
            this.updateMinimap();
            this.updateZoomDisplay();
            this.scheduleSyncViewport();
        }
    }
    
    zoomIn() {
        const viewportRect = this.viewport.getBoundingClientRect();
        const centerX = viewportRect.width / 2;
        const centerY = viewportRect.height / 2;
        
        const canvasX = this.viewport_x + centerX / this.zoom;
        const canvasY = this.viewport_y + centerY / this.zoom;
        
        this.zoom = Math.min(this.maxZoom, this.zoom * 1.2);
        
        this.viewport_x = canvasX - centerX / this.zoom;
        this.viewport_y = canvasY - centerY / this.zoom;
        
        this.clampViewport();
        this.updateViewport();
        this.updateMinimap();
        this.updateZoomDisplay();
        this.scheduleSyncViewport();
    }
    
    zoomOut() {
        const viewportRect = this.viewport.getBoundingClientRect();
        const centerX = viewportRect.width / 2;
        const centerY = viewportRect.height / 2;
        
        const canvasX = this.viewport_x + centerX / this.zoom;
        const canvasY = this.viewport_y + centerY / this.zoom;
        
        this.zoom = Math.max(this.minZoom, this.zoom / 1.2);
        
        this.viewport_x = canvasX - centerX / this.zoom;
        this.viewport_y = canvasY - centerY / this.zoom;
        
        this.clampViewport();
        this.updateViewport();
        this.updateMinimap();
        this.updateZoomDisplay();
        this.scheduleSyncViewport();
    }
    
    resetView() {
        this.viewport_x = this.canvasSize / 2 - window.innerWidth / 2;
        this.viewport_y = this.canvasSize / 2 - (window.innerHeight - 50) / 2;
        this.zoom = 1;
        this.updateViewport();
        this.updateMinimap();
        this.updateZoomDisplay();
        this.scheduleSyncViewport();
    }
    
    clampViewport() {
        const viewportRect = this.viewport.getBoundingClientRect();
        const maxX = this.canvasSize - viewportRect.width / this.zoom;
        const maxY = this.canvasSize - viewportRect.height / this.zoom;
        
        this.viewport_x = Math.max(0, Math.min(maxX, this.viewport_x));
        this.viewport_y = Math.max(0, Math.min(maxY, this.viewport_y));
    }
    
    updateViewport() {
        this.canvas.style.transform = `scale(${this.zoom}) translate(${-this.viewport_x}px, ${-this.viewport_y}px)`;
    }
    
    updateZoomDisplay() {
        document.getElementById('zoomLevel').textContent = `${Math.round(this.zoom * 100)}%`;
    }
    
    updateMinimap() {
        const viewportRect = this.viewport.getBoundingClientRect();
        const minimapRect = this.minimap.getBoundingClientRect();
        
        const scaleX = minimapRect.width / this.canvasSize;
        const scaleY = minimapRect.height / this.canvasSize;
        
        const vpWidth = (viewportRect.width / this.zoom) * scaleX;
        const vpHeight = (viewportRect.height / this.zoom) * scaleY;
        const vpX = this.viewport_x * scaleX;
        const vpY = this.viewport_y * scaleY;
        
        this.minimapViewport.style.left = `${vpX}px`;
        this.minimapViewport.style.top = `${vpY}px`;
        this.minimapViewport.style.width = `${vpWidth}px`;
        this.minimapViewport.style.height = `${vpHeight}px`;
    }
    
    onMinimapClick(e) {
        const rect = this.minimap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        const scaleX = this.canvasSize / rect.width;
        const scaleY = this.canvasSize / rect.height;
        
        const viewportRect = this.viewport.getBoundingClientRect();
        const vpHalfWidth = (viewportRect.width / this.zoom) / 2;
        const vpHalfHeight = (viewportRect.height / this.zoom) / 2;
        
        this.viewport_x = x * scaleX - vpHalfWidth;
        this.viewport_y = y * scaleY - vpHalfHeight;
        
        this.clampViewport();
        this.updateViewport();
        this.updateMinimap();
        this.scheduleSyncViewport();
    }
    
    // ========================================
    // Touch Events
    // ========================================
    
    onTouchStart(e) {
        if (e.touches.length === 1 && !e.target.closest('.canvas-item')) {
            const touch = e.touches[0];
            this.startPan(touch.clientX, touch.clientY);
        } else if (e.touches.length === 2) {
            // Pinch zoom
            this.pinchStart = this.getPinchDistance(e);
            this.pinchZoomStart = this.zoom;
        }
    }
    
    onTouchMove(e) {
        if (e.touches.length === 1 && this.isPanning) {
            e.preventDefault();
            const touch = e.touches[0];
            this.doPan(touch.clientX, touch.clientY);
        } else if (e.touches.length === 2 && this.pinchStart) {
            e.preventDefault();
            const pinchCurrent = this.getPinchDistance(e);
            const scale = pinchCurrent / this.pinchStart;
            this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.pinchZoomStart * scale));
            this.updateViewport();
            this.updateZoomDisplay();
        }
    }
    
    onTouchEnd(e) {
        if (e.touches.length === 0) {
            this.endPan();
            this.pinchStart = null;
            this.updateMinimap();
        }
    }
    
    getPinchDistance(e) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }
    
    // ========================================
    // Keyboard Shortcuts
    // ========================================
    
    onKeyDown(e) {
        // Ignore if typing in input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        const key = e.key.toLowerCase();
        
        // Track Shift for fast navigation
        if (e.shiftKey) {
            this.isShiftPressed = true;
        }
        
        // Space for pan mode
        if (e.code === 'Space' && !this.isSpacePressed) {
            e.preventDefault();
            this.isSpacePressed = true;
            this.viewport.classList.add('crosshair');
            return;
        }
        
        // WASD / Arrow Keys - add to pressed keys for smooth navigation
        if (['w', 'a', 's', 'd'].includes(key) || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            const navKey = this.normalizeNavKey(e.key);
            if (!this.keysPressed.has(navKey)) {
                this.keysPressed.add(navKey);
                this.startNavigation();
            }
            return;
        }
        
        // T for text
        if (key === 't' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.openTextEditorAtCenter();
            return;
        }
        
        // B for image
        if (key === 'b' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.triggerImageUpload();
            return;
        }
        
        // R for reset view
        if (key === 'r' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            this.resetView();
            return;
        }
        
        // Delete selected item
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedItem) {
            e.preventDefault();
            this.deleteItem(this.selectedItem);
        }
        
        // Escape to deselect
        if (e.key === 'Escape') {
            this.deselectAll();
            this.hideContextMenu();
            this.closeTextEditor();
            this.closeTodoEditor();
        }
    }
    
    onKeyUp(e) {
        if (e.code === 'Space') {
            this.isSpacePressed = false;
            this.viewport.classList.remove('crosshair');
        }
        
        // Track Shift release
        if (e.key === 'Shift') {
            this.isShiftPressed = false;
        }
        
        // Remove navigation keys
        const key = e.key.toLowerCase();
        if (['w', 'a', 's', 'd'].includes(key) || ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            const navKey = this.normalizeNavKey(e.key);
            this.keysPressed.delete(navKey);
            if (this.keysPressed.size === 0) {
                this.stopNavigation();
            }
        }
    }
    
    normalizeNavKey(key) {
        const keyMap = {
            'w': 'up', 'arrowup': 'up',
            's': 'down', 'arrowdown': 'down',
            'a': 'left', 'arrowleft': 'left',
            'd': 'right', 'arrowright': 'right'
        };
        return keyMap[key.toLowerCase()] || key.toLowerCase();
    }
    
    startNavigation() {
        if (this.isNavigating) return;
        this.isNavigating = true;
        this.navigationLoop();
    }
    
    stopNavigation() {
        this.isNavigating = false;
        // Save viewport position after navigation ends
        this.saveViewportPosition();
    }
    
    navigationLoop() {
        if (!this.isNavigating || this.keysPressed.size === 0) {
            this.isNavigating = false;
            return;
        }
        
        const speed = this.isShiftPressed ? this.navigationSpeedFast : this.navigationSpeed;
        let moved = false;
        
        if (this.keysPressed.has('up')) {
            this.viewport_y = Math.max(0, this.viewport_y - speed);
            moved = true;
        }
        if (this.keysPressed.has('down')) {
            this.viewport_y = Math.min(this.canvasSize - window.innerHeight / this.zoom, this.viewport_y + speed);
            moved = true;
        }
        if (this.keysPressed.has('left')) {
            this.viewport_x = Math.max(0, this.viewport_x - speed);
            moved = true;
        }
        if (this.keysPressed.has('right')) {
            this.viewport_x = Math.min(this.canvasSize - window.innerWidth / this.zoom, this.viewport_x + speed);
            moved = true;
        }
        
        if (moved) {
            this.updateViewport();
            this.updateMinimap();
        }
        
        requestAnimationFrame(() => this.navigationLoop());
    }
    
    // ========================================
    // Canvas Click & Context Menu
    // ========================================
    
    onCanvasClick(e) {
        // Only handle direct canvas clicks
        if (e.target !== this.canvas) return;
        
        // Get canvas position
        const rect = this.viewport.getBoundingClientRect();
        const canvasX = this.viewport_x + (e.clientX - rect.left) / this.zoom;
        const canvasY = this.viewport_y + (e.clientY - rect.top) / this.zoom;
        
        this.contextMenuPosition = { x: canvasX, y: canvasY };
        this.showContextMenu(e.clientX, e.clientY);
    }
    
    onCanvasRightClick(e) {
        e.preventDefault();
        
        const rect = this.viewport.getBoundingClientRect();
        const canvasX = this.viewport_x + (e.clientX - rect.left) / this.zoom;
        const canvasY = this.viewport_y + (e.clientY - rect.top) / this.zoom;
        
        this.contextMenuPosition = { x: canvasX, y: canvasY };
        this.showContextMenu(e.clientX, e.clientY);
    }
    
    showContextMenu(x, y) {
        this.contextMenu.style.left = `${x}px`;
        this.contextMenu.style.top = `${y}px`;
        this.contextMenu.classList.add('show');
    }
    
    hideContextMenu() {
        this.contextMenu.classList.remove('show');
    }
    
    onContextMenuAction(action) {
        this.hideContextMenu();
        
        switch (action) {
            case 'text':
                this.openTextEditor(this.contextMenuPosition.x, this.contextMenuPosition.y);
                break;
            case 'image':
                this.pendingImagePosition = this.contextMenuPosition;
                this.triggerImageUpload();
                break;
            case 'paste':
                this.pasteFromClipboard(this.contextMenuPosition.x, this.contextMenuPosition.y);
                break;
        }
    }
    
    // ========================================
    // Text Items
    // ========================================
    
    openTextEditorAtCenter() {
        const viewportRect = this.viewport.getBoundingClientRect();
        const centerX = this.viewport_x + viewportRect.width / 2 / this.zoom;
        const centerY = this.viewport_y + viewportRect.height / 2 / this.zoom;
        this.openTextEditor(centerX, centerY);
    }
    
    openTextEditor(x, y) {
        this.pendingTextPosition = { x, y };
        this.editingItemId = null;
        
        // Reset editor state
        document.getElementById('textInput').value = '';
        document.getElementById('fontSize').value = 24;
        document.getElementById('fontSizeValue').textContent = '24px';
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        document.querySelector('.color-btn[data-color="#ffffff"]').classList.add('active');
        document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
        
        this.textEditorState = { fontSize: 24, color: '#ffffff', bold: false, italic: false, glow: false };
        
        document.getElementById('textEditorTitle').textContent = 'Text hinzufügen';
        document.getElementById('textEditorModal').classList.add('show');
        document.getElementById('textInput').focus();
    }
    
    editTextItem(item) {
        this.editingItemId = item.id;
        
        document.getElementById('textInput').value = item.content;
        document.getElementById('fontSize').value = item.style.fontSize;
        document.getElementById('fontSizeValue').textContent = `${item.style.fontSize}px`;
        
        document.querySelectorAll('.color-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.color === item.style.color);
        });
        
        document.querySelectorAll('.style-btn').forEach(b => {
            const style = b.dataset.style;
            b.classList.toggle('active', item.style[style]);
        });
        
        this.textEditorState = { ...item.style };
        
        document.getElementById('textEditorTitle').textContent = 'Text bearbeiten';
        document.getElementById('textEditorModal').classList.add('show');
        document.getElementById('textInput').focus();
    }
    
    closeTextEditor() {
        document.getElementById('textEditorModal').classList.remove('show');
        this.editingItemId = null;
        this.pendingTextPosition = null;
    }
    
    saveTextItem() {
        const text = document.getElementById('textInput').value.trim();
        if (!text) {
            this.closeTextEditor();
            return;
        }
        
        if (this.editingItemId) {
            // Update existing
            const item = this.items.find(i => i.id === this.editingItemId);
            if (item) {
                item.content = text;
                item.style = { ...this.textEditorState };
                this.updateItemAPI(item);
            }
        } else {
            // Create new
            const item = {
                id: this.generateId(),
                type: 'text',
                x: this.pendingTextPosition?.x || this.canvasSize / 2,
                y: this.pendingTextPosition?.y || this.canvasSize / 2,
                content: text,
                style: { ...this.textEditorState },
                z_index: this.items.length
            };
            this.items.push(item);
            this.createItemAPI(item);
        }
        
        this.render();
        this.closeTextEditor();
    }
    
    // ========================================
    // Image Items
    // ========================================
    
    triggerImageUpload() {
        document.getElementById('imageInput').click();
    }
    
    handleImageSelect(e) {
        const files = e.target.files;
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                this.loadImageFile(file);
            }
        }
        e.target.value = '';
    }
    
    loadImageFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            this.addImageItem(e.target.result);
        };
        reader.readAsDataURL(file);
    }
    
    addImageItem(dataUrl, x, y) {
        const img = new Image();
        img.onload = () => {
            // Calculate size (max 400px width/height)
            let width = img.width;
            let height = img.height;
            const maxSize = 400;
            
            if (width > maxSize || height > maxSize) {
                const ratio = Math.min(maxSize / width, maxSize / height);
                width *= ratio;
                height *= ratio;
            }
            
            const item = {
                id: this.generateId(),
                type: 'image',
                x: x || this.pendingImagePosition?.x || this.canvasSize / 2,
                y: y || this.pendingImagePosition?.y || this.canvasSize / 2,
                width,
                height,
                content: dataUrl,
                style: {},
                z_index: this.items.length
            };
            
            this.items.push(item);
            this.createItemAPI(item);
            this.render();
            this.pendingImagePosition = null;
        };
        img.src = dataUrl;
    }
    
    // ========================================
    // Drag & Drop / Paste
    // ========================================
    
    onDrop(e) {
        e.preventDefault();
        this.viewport.classList.remove('dragover');
        
        const rect = this.viewport.getBoundingClientRect();
        const x = this.viewport_x + (e.clientX - rect.left) / this.zoom;
        const y = this.viewport_y + (e.clientY - rect.top) / this.zoom;
        
        const files = e.dataTransfer.files;
        for (const file of files) {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev) => this.addImageItem(ev.target.result, x, y);
                reader.readAsDataURL(file);
            }
        }
    }
    
    onPaste(e) {
        // Don't handle if in input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        const items = e.clipboardData?.items;
        if (!items) return;
        
        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const viewportRect = this.viewport.getBoundingClientRect();
                    const x = this.viewport_x + viewportRect.width / 2 / this.zoom;
                    const y = this.viewport_y + viewportRect.height / 2 / this.zoom;
                    this.addImageItem(ev.target.result, x, y);
                };
                reader.readAsDataURL(blob);
                return;
            }
        }
    }
    
    async pasteFromClipboard(x, y) {
        try {
            const clipboardItems = await navigator.clipboard.read();
            for (const clipboardItem of clipboardItems) {
                for (const type of clipboardItem.types) {
                    if (type.startsWith('image/')) {
                        const blob = await clipboardItem.getType(type);
                        const reader = new FileReader();
                        reader.onload = (e) => this.addImageItem(e.target.result, x, y);
                        reader.readAsDataURL(blob);
                        return;
                    }
                }
            }
            this.showNotification('Keine Bilder in der Zwischenablage');
        } catch (err) {
            console.error('Clipboard access error:', err);
            this.showNotification('Zugriff auf Zwischenablage verweigert');
        }
    }
    
    // ========================================
    // Item Interaction
    // ========================================
    
    selectItem(id) {
        this.selectedItem = id;
        this.render();
    }
    
    deselectAll() {
        this.selectedItem = null;
        this.render();
    }
    
    startDragItem(e, item) {
        e.stopPropagation();
        this.draggedItem = item;
        this.selectItem(item.id);
        
        const rect = this.viewport.getBoundingClientRect();
        const canvasX = this.viewport_x + (e.clientX - rect.left) / this.zoom;
        const canvasY = this.viewport_y + (e.clientY - rect.top) / this.zoom;
        
        this.dragOffset = {
            x: canvasX - item.x,
            y: canvasY - item.y
        };
    }
    
    doDragItem(clientX, clientY) {
        if (!this.draggedItem) return;
        
        const rect = this.viewport.getBoundingClientRect();
        const canvasX = this.viewport_x + (clientX - rect.left) / this.zoom;
        const canvasY = this.viewport_y + (clientY - rect.top) / this.zoom;
        
        this.draggedItem.x = canvasX - this.dragOffset.x;
        this.draggedItem.y = canvasY - this.dragOffset.y;
        
        this.render();
    }
    
    endDragItem() {
        if (this.draggedItem) {
            this.updateItemAPI(this.draggedItem);
            this.draggedItem = null;
        }
    }
    
    startResize(e, item) {
        e.stopPropagation();
        this.resizingItem = item;
        this.resizeStart = {
            x: e.clientX,
            y: e.clientY,
            width: item.width,
            height: item.height
        };
    }
    
    doResize(clientX, clientY) {
        if (!this.resizingItem) return;
        
        const dx = (clientX - this.resizeStart.x) / this.zoom;
        const dy = (clientY - this.resizeStart.y) / this.zoom;
        
        this.resizingItem.width = Math.max(50, this.resizeStart.width + dx);
        this.resizingItem.height = Math.max(50, this.resizeStart.height + dy);
        
        this.render();
    }
    
    endResize() {
        if (this.resizingItem) {
            this.updateItemAPI(this.resizingItem);
            this.resizingItem = null;
        }
    }
    
    deleteItem(id) {
        const index = this.items.findIndex(i => i.id === id);
        if (index !== -1) {
            this.items.splice(index, 1);
            this.deleteItemAPI(id);
            this.selectedItem = null;
            this.render();
        }
    }
    
    // ========================================
    // Render Canvas
    // ========================================
    
    render() {
        // Clear existing items (keep canvas background)
        const existingItems = this.canvas.querySelectorAll('.canvas-item');
        existingItems.forEach(el => el.remove());
        
        // Render items
        for (const item of this.items) {
            const el = this.createItemElement(item);
            this.canvas.appendChild(el);
        }
    }
    
    createItemElement(item) {
        const el = document.createElement('div');
        el.className = `canvas-item ${item.type}-item`;
        el.dataset.id = item.id;
        el.style.left = `${item.x}px`;
        el.style.top = `${item.y}px`;
        el.style.zIndex = item.z_index || 0;
        
        if (this.selectedItem === item.id) {
            el.classList.add('selected');
        }
        
        if (item.type === 'text') {
            el.textContent = item.content;
            el.style.fontSize = `${item.style.fontSize}px`;
            el.style.color = item.style.color;
            if (item.style.bold) el.style.fontWeight = 'bold';
            if (item.style.italic) el.style.fontStyle = 'italic';
            if (item.style.glow) el.classList.add('glow');
            
            // Double click to edit
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                this.editTextItem(item);
            });
        } else if (item.type === 'image') {
            el.style.width = `${item.width}px`;
            el.style.height = `${item.height}px`;
            
            const img = document.createElement('img');
            img.src = item.content;
            el.appendChild(img);
            
            // Resize handle
            const resizeHandle = document.createElement('div');
            resizeHandle.className = 'resize-handle';
            resizeHandle.addEventListener('mousedown', (e) => this.startResize(e, item));
            el.appendChild(resizeHandle);
        }
        
        // Delete button
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-btn';
        deleteBtn.innerHTML = '×';
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteItem(item.id);
        });
        el.appendChild(deleteBtn);
        
        // Drag handling
        el.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle') || e.target.classList.contains('delete-btn')) return;
            this.startDragItem(e, item);
        });
        
        // Click to select
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            this.selectItem(item.id);
            this.hideContextMenu();
        });
        
        return el;
    }
    
    // ========================================
    // Todos
    // ========================================
    
    openTodoEditor() {
        document.getElementById('todoTitle').value = '';
        document.querySelectorAll('.priority-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.priority === 'medium');
        });
        this.todoEditorState.priority = 'medium';
        document.getElementById('todoEditorModal').classList.add('show');
        document.getElementById('todoTitle').focus();
    }
    
    closeTodoEditor() {
        document.getElementById('todoEditorModal').classList.remove('show');
    }
    
    saveTodoItem() {
        const text = document.getElementById('todoTitle').value.trim();
        if (!text) {
            this.closeTodoEditor();
            return;
        }
        
        const todo = {
            id: this.generateId(),
            text,
            completed: false,
            priority: this.todoEditorState.priority,
            created_at: Date.now()
        };
        
        this.todos.push(todo);
        this.createTodoAPI(todo);
        this.renderTodos();
        this.closeTodoEditor();
    }
    
    toggleTodo(id) {
        const todo = this.todos.find(t => t.id === id);
        if (todo) {
            todo.completed = !todo.completed;
            this.updateTodoAPI(todo);
            this.renderTodos();
        }
    }
    
    deleteTodo(id) {
        const index = this.todos.findIndex(t => t.id === id);
        if (index !== -1) {
            this.todos.splice(index, 1);
            this.deleteTodoAPI(id);
            this.renderTodos();
        }
    }
    
    renderTodos() {
        const activeTodos = this.todos.filter(t => !t.completed);
        const completedTodos = this.todos.filter(t => t.completed);
        
        document.getElementById('activeCount').textContent = activeTodos.length;
        document.getElementById('completedCount').textContent = completedTodos.length;
        
        document.getElementById('activeTodos').innerHTML = activeTodos.map(t => this.createTodoHTML(t)).join('');
        document.getElementById('completedTodos').innerHTML = completedTodos.map(t => this.createTodoHTML(t)).join('');
        
        // Bind events
        document.querySelectorAll('.todo-checkbox').forEach(el => {
            el.addEventListener('click', () => this.toggleTodo(el.dataset.id));
        });
        document.querySelectorAll('.todo-delete').forEach(el => {
            el.addEventListener('click', () => this.deleteTodo(el.dataset.id));
        });
    }
    
    createTodoHTML(todo) {
        return `
            <div class="todo-item ${todo.completed ? 'completed' : ''}">
                <div class="todo-checkbox" data-id="${todo.id}"></div>
                <div class="todo-content">
                    <div class="todo-text">${this.escapeHtml(todo.text)}</div>
                </div>
                <span class="todo-priority ${todo.priority}">${todo.priority}</span>
                <button class="todo-delete" data-id="${todo.id}">×</button>
            </div>
        `;
    }
    
    // ========================================
    // API / Backend Communication
    // ========================================
    
    setSyncStatus(status) {
        this.syncStatus.classList.remove('syncing', 'error');
        if (status === 'syncing') {
            this.syncStatus.classList.add('syncing');
            this.syncStatus.title = 'Synchronisiere...';
        } else if (status === 'error') {
            this.syncStatus.classList.add('error');
            this.syncStatus.title = 'Synchronisation fehlgeschlagen';
        } else {
            this.syncStatus.title = 'Synchronisiert';
        }
    }
    
    async loadFromServer() {
        try {
            this.setSyncStatus('syncing');
            const response = await fetch(`${this.apiBase}/board/${this.boardId}`, {
                headers: getAuthHeaders()
            });
            if (response.ok) {
                const data = await response.json();
                this.items = data.items || [];
                this.todos = data.todos || [];
                if (data.board.viewport) {
                    this.viewport_x = data.board.viewport.x || this.viewport_x;
                    this.viewport_y = data.board.viewport.y || this.viewport_y;
                }
                if (data.board.zoom) {
                    this.zoom = data.board.zoom;
                }
                this.setSyncStatus('ok');
            } else {
                throw new Error('Failed to load');
            }
        } catch (err) {
            console.log('Backend not available, using local storage fallback');
            this.loadFromLocalStorage();
            this.setSyncStatus('error');
        }
    }
    
    loadFromLocalStorage() {
        try {
            const saved = localStorage.getItem('visionboard_data');
            if (saved) {
                const data = JSON.parse(saved);
                this.items = data.items || [];
                this.todos = data.todos || [];
                this.viewport_x = data.viewport_x || this.viewport_x;
                this.viewport_y = data.viewport_y || this.viewport_y;
                this.zoom = data.zoom || 1;
            }
        } catch (e) {
            console.error('Error loading from localStorage:', e);
        }
    }
    
    saveToLocalStorage() {
        const data = {
            items: this.items,
            todos: this.todos,
            viewport_x: this.viewport_x,
            viewport_y: this.viewport_y,
            zoom: this.zoom
        };
        localStorage.setItem('visionboard_data', JSON.stringify(data));
    }
    
    async createItemAPI(item) {
        this.saveToLocalStorage();
        try {
            await fetch(`${this.apiBase}/items`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ ...item, board_id: this.boardId })
            });
        } catch (err) {
            console.error('API error:', err);
        }
    }
    
    async updateItemAPI(item) {
        this.saveToLocalStorage();
        try {
            await fetch(`${this.apiBase}/items/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(item)
            });
        } catch (err) {
            console.error('API error:', err);
        }
    }
    
    async deleteItemAPI(id) {
        this.saveToLocalStorage();
        try {
            await fetch(`${this.apiBase}/items/${id}`, { 
                method: 'DELETE',
                headers: getAuthHeaders()
            });
        } catch (err) {
            console.error('API error:', err);
        }
    }
    
    async createTodoAPI(todo) {
        this.saveToLocalStorage();
        try {
            await fetch(`${this.apiBase}/todos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ ...todo, board_id: this.boardId })
            });
        } catch (err) {
            console.error('API error:', err);
        }
    }
    
    async updateTodoAPI(todo) {
        this.saveToLocalStorage();
        try {
            await fetch(`${this.apiBase}/todos/${todo.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify(todo)
            });
        } catch (err) {
            console.error('API error:', err);
        }
    }
    
    async deleteTodoAPI(id) {
        this.saveToLocalStorage();
        try {
            await fetch(`${this.apiBase}/todos/${id}`, { 
                method: 'DELETE',
                headers: getAuthHeaders()
            });
        } catch (err) {
            console.error('API error:', err);
        }
    }
    
    scheduleSyncViewport() {
        clearTimeout(this.syncTimeout);
        this.syncTimeout = setTimeout(() => this.syncViewportToServer(), 1000);
    }
    
    async syncViewportToServer() {
        this.saveToLocalStorage();
        try {
            await fetch(`${this.apiBase}/board/${this.boardId}/viewport`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({ x: this.viewport_x, y: this.viewport_y, zoom: this.zoom })
            });
        } catch (err) {
            console.error('API error:', err);
        }
    }
    
    async syncToServer() {
        this.saveToLocalStorage();
        try {
            await fetch(`${this.apiBase}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                body: JSON.stringify({
                    board_id: this.boardId,
                    items: this.items,
                    todos: this.todos,
                    viewport: { x: this.viewport_x, y: this.viewport_y, zoom: this.zoom }
                })
            });
        } catch (err) {
            console.error('Sync error:', err);
        }
    }
    
    // ========================================
    // Utilities
    // ========================================
    
    generateId() {
        return `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    showNotification(message, duration = 2000) {
        const notification = document.getElementById('notification');
        notification.textContent = message;
        notification.classList.add('show');
        setTimeout(() => notification.classList.remove('show'), duration);
    }
}
