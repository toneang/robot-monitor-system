import { marked } from 'marked';
import { graphService } from '../../services/graph.service.js';

export class UserProfileModal {
    constructor() {
        this.isOpen = false;
        this.modal = null;
        this.userId = null;
        this.init();
    }

    init() {
        // Create modal container
        this.modal = document.createElement('div');
        this.modal.id = 'user-profile-modal';
        this.modal.className = 'fixed inset-0 bg-black/50 hidden items-center justify-center z-[60] backdrop-blur-sm transition-opacity duration-300';
        
        // Modal content
        this.modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full max-w-4xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
                <!-- Header -->
                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 class="text-lg font-bold text-gray-800 flex items-center">
                        <i class="fa fa-user-circle text-primary mr-2"></i>
                        User Profile: <span id="profile-modal-user-id" class="ml-1 text-primary">Loading...</span>
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
                        <!-- Tags Section -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <!-- Helper Functions -->
                            <div class="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                <h4 class="font-bold text-blue-800 mb-3 flex items-center">
                                    <i class="fa fa-tags mr-2"></i> Task Style & Preferences
                                </h4>
                                <div id="profile-tags-container" class="space-y-3">
                                    <!-- Tags will be injected here -->
                                </div>
                            </div>
                            
                            <!-- Stats / Metadata -->
                            <div class="bg-purple-50 p-4 rounded-lg border border-purple-100">
                                <h4 class="font-bold text-purple-800 mb-3 flex items-center">
                                    <i class="fa fa-bar-chart mr-2"></i> Performance Metrics
                                </h4>
                                <div id="profile-stats-container" class="space-y-2 text-sm">
                                    <!-- Stats will be injected here -->
                                </div>
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
                        <p id="profile-error-msg">Failed to load profile data.</p>
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

    async open(userId) {
        if (!userId) return;
        this.userId = userId;
        this.isOpen = true;
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');
        
        // Reset UI
        this.modal.querySelector('#profile-modal-user-id').textContent = userId;
        this.modal.querySelector('#profile-loading').classList.remove('hidden');
        this.modal.querySelector('#profile-content').classList.add('hidden');
        this.modal.querySelector('#profile-error').classList.add('hidden');
        
        try {
            // Fetch data in parallel
            const [tagsData, markdownData] = await Promise.all([
                graphService.getProfileTags(userId).catch(e => {
                    console.error("Tags fetch failed", e);
                    return null;
                }),
                graphService.getProfileMarkdown(userId).catch(e => {
                    console.error("Markdown fetch failed", e);
                    return null;
                })
            ]);
            
            this.renderProfile(tagsData, markdownData);
            
            this.modal.querySelector('#profile-loading').classList.add('hidden');
            this.modal.querySelector('#profile-content').classList.remove('hidden');
        } catch (error) {
            console.error('Error loading profile:', error);
            this.modal.querySelector('#profile-loading').classList.add('hidden');
            this.modal.querySelector('#profile-error').classList.remove('hidden');
            this.modal.querySelector('#profile-error-msg').textContent = error.message || 'Failed to load profile data';
        }
    }

    renderProfile(tags, markdown) {
        const tagsContainer = this.modal.querySelector('#profile-tags-container');
        const statsContainer = this.modal.querySelector('#profile-stats-container');
        const mdContainer = this.modal.querySelector('#profile-markdown-content');
        const updatedAtLabel = this.modal.querySelector('#profile-updated-at');
        
        // Clear previous
        tagsContainer.innerHTML = '';
        statsContainer.innerHTML = '';
        mdContainer.innerHTML = '';
        updatedAtLabel.textContent = '';

        if (tags) {
            // Render Task Style tags
            if (tags.task_style && tags.task_style.length > 0) {
                const styleHtml = tags.task_style.map(tag => `
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 mr-2 mb-2">
                        ${tag.name} <span class="ml-1 opacity-75 text-[10px]">${(tag.confidence * 100).toFixed(0)}%</span>
                    </span>
                `).join('');
                tagsContainer.innerHTML += `<div><div class="text-xs text-blue-600 mb-1 font-semibold">Style</div><div class="flex flex-wrap">${styleHtml}</div></div>`;
            }
            
            // Render Preference tags
             if (tags.preference && tags.preference.length > 0) {
                const prefHtml = tags.preference.map(tag => `
                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 mr-2 mb-2">
                        ${tag.name}
                    </span>
                `).join('');
                tagsContainer.innerHTML += `<div class="mt-2"><div class="text-xs text-green-600 mb-1 font-semibold">Preferences</div><div class="flex flex-wrap">${prefHtml}</div></div>`;
            }

            // Render Stats
            const metadata = tags.metadata || {};
            const stats = [
                { label: 'Total Tasks', value: metadata.total_tasks_count },
                { label: 'Success Rate', value: tags.success_rate && tags.success_rate.length > 0 ? `${(tags.success_rate[0].confidence * 100).toFixed(1)}%` : 'N/A' },
            ];
            
            statsContainer.innerHTML = stats.map(s => `
                <div class="flex justify-between items-center bg-white/60 p-2 rounded">
                    <span class="text-gray-600">${s.label}</span>
                    <span class="font-mono font-bold text-gray-800">${s.value || '-'}</span>
                </div>
            `).join('');
        }

        if (markdown) {
            if (markdown.updated_at) {
                updatedAtLabel.textContent = `Last updated: ${new Date(markdown.updated_at).toLocaleString()}`;
            }
            if (markdown.content) {
                mdContainer.innerHTML = marked.parse(markdown.content);
            } else {
                mdContainer.innerHTML = '<em class="text-gray-400">No detailed analysis available.</em>';
            }
        }
    }

    close() {
        this.isOpen = false;
        this.modal.classList.add('hidden');
        this.modal.classList.remove('flex');
    }
}
