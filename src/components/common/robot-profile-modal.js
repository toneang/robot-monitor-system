import { marked } from 'marked';
import { graphService } from '../../services/graph.service.js';

export class RobotProfileModal {
    constructor() {
        this.isOpen = false;
        this.modal = null;
        this.robotId = null;
        this.pollingInterval = null;
        this.init();
    }

    init() {
        // Create modal container
        this.modal = document.createElement('div');
        this.modal.id = 'robot-profile-modal';
        this.modal.className = 'fixed inset-0 bg-black/50 hidden items-center justify-center z-[60] backdrop-blur-sm transition-opacity duration-300';

        // Modal content
        this.modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
                <!-- Header -->
                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 class="text-lg font-bold text-gray-800 flex items-center">
                        <i class="fa fa-robot text-primary mr-2"></i>
                        Robot Profile: <span id="profile-modal-robot-id" class="ml-1 text-primary">Loading...</span>
                    </h3>
                    <button id="close-profile-modal" class="text-gray-400 hover:text-gray-600 transition-colors">
                        <i class="fa fa-times text-xl"></i>
                    </button>
                </div>

                <!-- Content -->
                <div class="flex-1 overflow-y-auto p-6 space-y-6">
                    <!-- Status / Loading -->
                    <div id="profile-loading" class="flex justify-center items-center py-12">
                        <i class="fa fa-spinner fa-spin text-3xl text-primary"></i>
                    </div>

                    <!-- Main Content (Hidden by default) -->
                    <div id="profile-content" class="hidden space-y-6">
                        <!-- Performance Summary -->
                        <div class="bg-blue-50 p-4 rounded-lg border border-blue-100">
                            <h4 class="font-bold text-blue-800 mb-3 flex items-center">
                                <i class="fa fa-chart-line mr-2"></i> Performance Summary
                            </h4>
                            <div id="profile-summary-container" class="text-gray-700">
                                <!-- Summary will be injected here -->
                            </div>
                        </div>

                        <!-- Tags Section -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <!-- Ability Level -->
                            <div class="bg-green-50 p-4 rounded-lg border border-green-100">
                                <h4 class="font-bold text-green-800 mb-3 flex items-center">
                                    <i class="fa fa-graduation-cap mr-2"></i> Ability Level
                                </h4>
                                <div id="profile-ability-container" class="space-y-3">
                                    <!-- Ability tags will be injected here -->
                                </div>
                            </div>

                            <!-- Specialization -->
                            <div class="bg-purple-50 p-4 rounded-lg border border-purple-100">
                                <h4 class="font-bold text-purple-800 mb-3 flex items-center">
                                    <i class="fa fa-star mr-2"></i> Specialization
                                </h4>
                                <div id="profile-specialization-container" class="space-y-3">
                                    <!-- Specialization tags will be injected here -->
                                </div>
                            </div>
                        </div>

                        <!-- Success Pattern -->
                        <div class="bg-yellow-50 p-4 rounded-lg border border-yellow-100">
                            <h4 class="font-bold text-yellow-800 mb-3 flex items-center">
                                <i class="fa fa-check-circle mr-2"></i> Success Patterns
                            </h4>
                            <div id="profile-success-container" class="space-y-3">
                                <!-- Success pattern tags will be injected here -->
                            </div>
                        </div>

                        <!-- Weakness -->
                        <div class="bg-red-50 p-4 rounded-lg border border-red-100">
                            <h4 class="font-bold text-red-800 mb-3 flex items-center">
                                <i class="fa fa-exclamation-triangle mr-2"></i> Areas for Improvement
                            </h4>
                            <div id="profile-weakness-container" class="space-y-3">
                                <!-- Weakness tags will be injected here -->
                            </div>
                        </div>

                        <!-- Markdown Section -->
                        <div class="border-t border-gray-100 pt-6">
                            <h4 class="font-bold text-gray-800 mb-4 flex items-center justify-between">
                                <span><i class="fa fa-file-text-o text-gray-500 mr-2"></i> Detailed Analysis</span>
                                <span id="profile-updated-at" class="text-xs text-gray-400 font-normal"></span>
                            </h4>
                            <div id="profile-markdown-content" class="prose prose-sm max-w-none text-gray-600 bg-gray-50 p-4 rounded-lg border border-gray-200">
                                <!-- Markdown content here -->
                            </div>
                        </div>
                    </div>

                    <!-- Error State -->
                    <div id="profile-error" class="hidden text-center py-8 text-red-500">
                        <i class="fa fa-exclamation-triangle text-3xl mb-2"></i>
                        <p id="profile-error-msg">Failed to load robot profile data.</p>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.modal);

        // Bind events
        this.modal.querySelector('#close-profile-modal').addEventListener('click', () => this.close());
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.close();
        });
    }

    async open(robotId) {
        if (!robotId) return;
        this.robotId = robotId;
        this.isOpen = true;
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');

        console.log('[RobotProfileModal] Opening for robot:', robotId);

        // Start polling
        this.startPolling();

        // Reset UI
        this.modal.querySelector('#profile-modal-robot-id').textContent = robotId;
        this.modal.querySelector('#profile-loading').classList.remove('hidden');
        this.modal.querySelector('#profile-content').classList.add('hidden');
        this.modal.querySelector('#profile-error').classList.add('hidden');

        await this.loadProfile();
    }

    close() {
        this.isOpen = false;
        this.modal.classList.add('hidden');
        this.modal.classList.remove('flex');

        // Stop polling
        this.stopPolling();
    }

    startPolling() {
        // Poll every 20 minutes (1200000 ms)
        this.pollingInterval = setInterval(() => {
            if (this.isOpen) {
                this.loadProfile();
            }
        }, 1200000);
    }

    stopPolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
        }
    }

    async loadProfile() {
        console.log('[RobotProfileModal] Loading profile for:', this.robotId);

        try {
            // Fetch data in parallel
            const [tagsData, markdownData] = await Promise.all([
                graphService.getRobotProfileTags(this.robotId).catch(e => {
                    console.error("Robot tags fetch failed", e);
                    return null;
                }),
                graphService.getRobotProfileMarkdown(this.robotId).catch(e => {
                    console.error("Robot markdown fetch failed", e);
                    return null;
                })
            ]);

            console.log('[RobotProfileModal] Fetched data:', { tagsData, hasMarkdown: !!markdownData });

            if (!tagsData && !markdownData) {
                // Both failed
                throw new Error("Unable to load profile data (Service unavailable or 404).");
            }

            this.renderProfile(tagsData, markdownData);

            this.modal.querySelector('#profile-loading').classList.add('hidden');
            this.modal.querySelector('#profile-content').classList.remove('hidden');
        } catch (error) {
            console.error('Error loading robot profile:', error);
            this.modal.querySelector('#profile-loading').classList.add('hidden');
            this.modal.querySelector('#profile-error').classList.remove('hidden');
            this.modal.querySelector('#profile-error-msg').textContent = error.message || 'Failed to load robot profile data';
        }
    }

    renderProfile(tags, markdown) {
        console.log('[RobotProfileModal] Rendering profile:', { tags, markdown });

        const summaryContainer = this.modal.querySelector('#profile-summary-container');
        const abilityContainer = this.modal.querySelector('#profile-ability-container');
        const specializationContainer = this.modal.querySelector('#profile-specialization-container');
        const successContainer = this.modal.querySelector('#profile-success-container');
        const weaknessContainer = this.modal.querySelector('#profile-weakness-container');
        const mdContainer = this.modal.querySelector('#profile-markdown-content');
        const updatedAtLabel = this.modal.querySelector('#profile-updated-at');

        // Check if elements exist
        if (!summaryContainer || !abilityContainer || !specializationContainer ||
            !successContainer || !weaknessContainer || !mdContainer || !updatedAtLabel) {
            console.error('[RobotProfileModal] Missing DOM elements');
            return;
        }

        // Clear previous
        summaryContainer.innerHTML = '';
        abilityContainer.innerHTML = '';
        specializationContainer.innerHTML = '';
        successContainer.innerHTML = '';
        weaknessContainer.innerHTML = '';
        mdContainer.innerHTML = '';
        updatedAtLabel.textContent = '';

        if (tags) {
            // Render Performance Summary
            if (tags.performance_summary) {
                summaryContainer.innerHTML = `
                    <p class="leading-relaxed">${tags.performance_summary}</p>
                `;
            } else {
                summaryContainer.innerHTML = '<em class="text-gray-400">No summary available.</em>';
            }

            // Render Ability Level
            if (tags.ability_level && tags.ability_level.length > 0) {
                abilityContainer.innerHTML = tags.ability_level.map(tag => `
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 mr-2 mb-2">
                        ${tag.name} <span class="ml-1 opacity-75 text-[10px]">${(tag.confidence * 100).toFixed(0)}%</span>
                    </span>
                `).join('');
            } else {
                abilityContainer.innerHTML = '<em class="text-sm text-gray-400">No ability data.</em>';
            }

            // Render Specialization
            if (tags.specialization && tags.specialization.length > 0) {
                specializationContainer.innerHTML = tags.specialization.map(tag => `
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 mr-2 mb-2">
                        ${tag.name} <span class="ml-1 opacity-75 text-[10px]">${(tag.confidence * 100).toFixed(0)}%</span>
                    </span>
                `).join('');
            } else {
                 specializationContainer.innerHTML = '<em class="text-sm text-gray-400">No specialization data.</em>';
            }

            // Render Success Patterns
            if (tags.success_pattern && tags.success_pattern.length > 0) {
                successContainer.innerHTML = tags.success_pattern.map(tag => `
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 mr-2 mb-2">
                        ${tag.name} <span class="ml-1 opacity-75 text-[10px]">${(tag.confidence * 100).toFixed(0)}%</span>
                    </span>
                `).join('');
            } else {
                successContainer.innerHTML = '<em class="text-sm text-gray-400">No success patterns.</em>';
            }

            // Render Weakness
            if (tags.weakness && tags.weakness.length > 0) {
                weaknessContainer.innerHTML = tags.weakness.map(tag => `
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 mr-2 mb-2">
                        ${tag.name} <span class="ml-1 opacity-75 text-[10px]">${(tag.confidence * 100).toFixed(0)}%</span>
                    </span>
                `).join('');
            } else {
                weaknessContainer.innerHTML = '<em class="text-sm text-gray-400">No weakness data.</em>';
            }
        } else {
            // Tags fetch failed but maybe markdown succeeded
             summaryContainer.innerHTML = '<em class="text-gray-400">Profile tags unavailable.</em>';
             abilityContainer.innerHTML = '<em class="text-sm text-gray-400">--</em>';
             specializationContainer.innerHTML = '<em class="text-sm text-gray-400">--</em>';
             successContainer.innerHTML = '<em class="text-sm text-gray-400">--</em>';
             weaknessContainer.innerHTML = '<em class="text-sm text-gray-400">--</em>';
        }

        if (markdown) {
            if (markdown.updated_at) {
                updatedAtLabel.textContent = `Last updated: ${new Date(markdown.updated_at).toLocaleString()}`;
            }
            if (markdown.content) {
                try {
                     mdContainer.innerHTML = marked.parse(markdown.content);
                } catch (e) {
                     console.error("Markdown parsing error:", e);
                     mdContainer.innerHTML = `<div class="text-red-500">Error parsing markdown content. <pre class="text-xs mt-2 overflow-auto">${e.message}</pre></div>`;
                }
            } else {
                mdContainer.innerHTML = '<em class="text-gray-400">No detailed analysis available.</em>';
            }
        } else {
            mdContainer.innerHTML = '<em class="text-gray-400">Analysis content unavailable.</em>';
        }
    }
}
