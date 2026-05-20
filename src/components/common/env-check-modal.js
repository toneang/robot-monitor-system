export class EnvCheckModal {
    constructor() {
        this.modal = document.getElementById('envCheckModal');
        this.messageEl = document.getElementById('envCheckMessage');
        this.closeBtn = document.getElementById('closeEnvCheckBtn');
        this.onConfirm = null;
        this.init();
    }

    init() {
        if (this.closeBtn) {
            this.closeBtn.addEventListener('click', () => {
                if (this.onConfirm && typeof this.onConfirm === 'function') {
                    this.onConfirm();
                }
                this.hide();
            });
        }
        
        // Close on click outside
        if (this.modal) {
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) {
                    this.hide();
                }
            });
        }
    }

    show(message) {
        if (this.messageEl) {
            this.messageEl.textContent = message;
        }
        if (this.modal) {
            this.modal.classList.remove('hidden');
            this.modal.classList.add('flex'); // Ensure flex is added for centering
        }
    }

    hide() {
        if (this.modal) {
            this.modal.classList.add('hidden');
            this.modal.classList.remove('flex');
        }
    }
    setOnConfirm(callback) {
        this.onConfirm = callback;
    }
}
