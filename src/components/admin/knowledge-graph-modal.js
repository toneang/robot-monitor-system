import * as echarts from 'echarts';
import { graphService } from '../../services/graph.service.js';
import { UserProfileModal } from './user-profile-modal.js';

export class KnowledgeGraphModal {
    constructor() {
        this.isOpen = false;
        this.chart = null;
        this.modal = null;
        this.userProfileModal = new UserProfileModal();
        this.lastCategories = [];
        this.currentGraphType = 'person-person';
        this.graphTypes = [
            { id: 'person-person', name: 'Person Relations', description: 'Interactions between people (roles, collaboration)' },
            { id: 'person-object', name: 'Person-Object', description: 'Personal preferences, ownership, frequently used items' },
            { id: 'area-hierarchy', name: 'Area Hierarchy', description: 'Spatial layout with clustered coordinates and parent-child areas' }
        ];
        this.categoryColors = ['#5470c6', '#91cc75', '#fac858', '#ee6666', '#73c0de', '#3ba272'];
        this.init();
    }

    init() {
        this.modal = document.createElement('div');
        this.modal.id = 'knowledge-graph-modal';
        this.modal.className = 'fixed inset-0 bg-black/80 hidden items-center justify-center z-50 backdrop-blur-sm transition-opacity duration-300';

        const graphTypeOptions = this.graphTypes.map(type =>
            `<button class="graph-type-btn ${type.id === 'person-person' ? 'active' : ''}" data-type="${type.id}" title="${type.description}">
                ${type.name}
            </button>`
        ).join('');

        this.modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl w-full h-full max-w-[95%] max-h-[90%] flex flex-col overflow-hidden relative">
                <!-- Header -->
                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 z-10">
                    <div class="flex items-center space-x-4">
                        <div>
                            <h3 class="text-xl font-bold text-gray-800">
                                <i class="fa fa-share-alt text-primary mr-2"></i> Knowledge Graph
                            </h3>
                            <p class="text-xs text-gray-500 mt-1" id="graph-description">
                                Interactions between people (roles, collaboration)
                            </p>
                        </div>
                        <div class="flex flex-wrap gap-2 ml-6">
                            ${graphTypeOptions}
                        </div>
                    </div>
                    <div class="flex items-center space-x-4">
                        <div id="graph-legend" class="flex items-center text-xs text-gray-500 space-x-2"></div>
                        <button id="refresh-graph" class="p-2 text-primary hover:bg-blue-50 rounded-full transition-colors" title="Refresh Data">
                            <i class="fa fa-refresh"></i>
                        </button>
                        <button id="close-graph-modal" class="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors">
                            <i class="fa fa-times text-xl"></i>
                        </button>
                    </div>
                </div>

                <!-- Graph Container -->
                <div id="graph-container" class="flex-1 w-full h-full bg-gray-50 relative">
                    <div id="graph-loading" class="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-20">
                        <i class="fa fa-circle-o-notch fa-spin text-4xl text-primary mb-3"></i>
                        <span class="text-gray-500 font-medium">Loading graph data...</span>
                    </div>
                </div>

                <!-- Info Panel -->
                <div class="absolute bottom-6 left-6 bg-white/90 p-4 rounded-lg shadow-lg border border-gray-100 max-w-xs text-sm text-gray-600 backdrop-blur pointer-events-none select-none z-10 hidden md:block">
                    <strong>Tip:</strong> Drag nodes to rearrange. Click a <span class="text-[#5470c6] font-bold">Person</span> node to view profile. Scroll to zoom.
                </div>
            </div>

            <style>
                .graph-type-btn {
                    padding: 6px 12px;
                    font-size: 12px;
                    border: 1px solid #e5e7eb;
                    background: white;
                    border-radius: 6px;
                    cursor: pointer;
                    transition: all 0.2s;
                    color: #6b7280;
                }
                .graph-type-btn:hover { background: #f3f4f6; border-color: #d1d5db; }
                .graph-type-btn.active { background: #eff6ff; border-color: #3b82f6; color: #3b82f6; font-weight: 500; }
            </style>
        `;

        document.body.appendChild(this.modal);

        this.modal.querySelector('#close-graph-modal').addEventListener('click', () => this.close());
        this.modal.querySelector('#refresh-graph').addEventListener('click', () => this.loadGraph());

        this.modal.querySelectorAll('.graph-type-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchGraphType(btn.dataset.type));
        });

        window.addEventListener('resize', () => { if (this.chart) this.chart.resize(); });
    }

    switchGraphType(type) {
        this.currentGraphType = type;

        this.modal.querySelectorAll('.graph-type-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.type === type);
        });

        const typeInfo = this.graphTypes.find(t => t.id === type);
        if (typeInfo) {
            const descEl = this.modal.querySelector('#graph-description');
            if (descEl) descEl.textContent = typeInfo.description;
        }

        this.loadGraph();
    }

    async open() {
        this.isOpen = true;
        this.modal.classList.remove('hidden');
        this.modal.classList.add('flex');

        if (!this.chart) {
            const dom = document.getElementById("graph-container");
            this.chart = echarts.init(dom);
            this.setupChartEvents();
        }

        await this.loadGraph();
        setTimeout(() => { if (this.chart) this.chart.resize(); }, 100);
    }

    close() {
        this.isOpen = false;
        this.modal.classList.add('hidden');
        this.modal.classList.remove('flex');
    }

    normalizeGraphPayload(rawData) {
        const payload = rawData && typeof rawData === 'object' ? rawData : {};
        const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
        const links = Array.isArray(payload.links) ? payload.links : [];
        const categories = Array.isArray(payload.categories) && payload.categories.length > 0
            ? payload.categories.map((cat) => (typeof cat === 'string' ? { name: cat } : cat))
            : [{ name: 'Node' }];

        const nodeIdSet = new Set();
        const normalizedNodes = nodes.map((node, index) => {
            const id = String(node.id ?? `node_${index}`);
            nodeIdSet.add(id);
            const name = node.name ?? id;
            const category = Number.isFinite(node.category) ? Number(node.category) : 0;
            const categoryName = String(categories[category]?.name || '').toLowerCase();
            // Person nodes in person-person graph, or category 0 Person nodes
            const isUserNode = categoryName === 'person';
            return { ...node, id, name, category, __isUserNode: isUserNode };
        });

        const normalizedLinks = links
            .map((link) => {
                const source = String(link.source ?? '');
                const target = String(link.target ?? '');
                if (!source || !target) return null;
                return { ...link, source, target, value: link.value ?? '' };
            })
            .filter((link) => link && nodeIdSet.has(link.source) && nodeIdSet.has(link.target));

        return { nodes: normalizedNodes, links: normalizedLinks, categories };
    }

    setupChartEvents() {
        this.chart.on('click', (params) => {
            if (params.dataType === 'node' && params.data.__isUserNode) {
                this.userProfileModal.open(params.data.name);
            }
        });
    }

    async loadGraph() {
        const loadingEl = this.modal.querySelector('#graph-loading');
        if (loadingEl) loadingEl.classList.remove('hidden');
        this.chart.showLoading();

        try {
            let data;
            switch (this.currentGraphType) {
                case 'person-person':
                    data = await graphService.getPersonPersonGraph(null, 200);
                    break;
                case 'person-object':
                    data = await graphService.getPersonObjectGraph(null, null, 200);
                    break;
                case 'area-hierarchy':
                    data = await graphService.getAreaHierarchyGraph(null, 100);
                    break;
                default:
                    data = await graphService.getPersonPersonGraph(null, 200);
            }

            const normalizedData = this.normalizeGraphPayload(data);
            this.lastCategories = normalizedData.categories;
            this.renderGraph(normalizedData);
            this.updateLegend(normalizedData.categories);
        } catch (error) {
            console.error('Failed to load graph:', error);
            this.chart.setOption({
                title: {
                    text: 'Failed to load data',
                    subtext: error.message,
                    left: 'center', top: 'center',
                    textStyle: { color: '#ef4444', fontSize: 18 },
                    subtextStyle: { color: '#6b7280', fontSize: 14 }
                }
            });
        } finally {
            this.chart.hideLoading();
            if (loadingEl) loadingEl.classList.add('hidden');
        }
    }

    updateLegend(categories) {
        const legendEl = this.modal.querySelector('#graph-legend');
        if (!legendEl || !categories) return;
        legendEl.innerHTML = categories.map((cat, index) => {
            const color = this.categoryColors[index % this.categoryColors.length];
            return `<div class="flex items-center"><span class="w-2 h-2 rounded-full mr-1" style="background: ${color}"></span>${cat.name}</div>`;
        }).join('');
    }

    renderGraph(graphData) {
        if (!graphData || !Array.isArray(graphData.nodes) || graphData.nodes.length === 0) {
            this.chart.setOption({
                title: {
                    text: 'No graph data', subtext: 'No nodes available.',
                    left: 'center', top: 'center',
                    textStyle: { color: '#6b7280', fontSize: 16 },
                    subtextStyle: { color: '#9ca3af', fontSize: 12 }
                },
                series: [{ type: 'graph', data: [], links: [] }]
            });
            return;
        }

        const option = {
            tooltip: {
                formatter: function (params) {
                    if (params.dataType === 'node') {
                        return `<strong>${params.name}</strong><br/>${params.data.value || ''}`;
                    } else {
                        return `<strong>${params.data.value || 'relation'}</strong>`;
                    }
                }
            },
            legend: [{ data: graphData.categories.map(a => a.name) }],
            color: this.categoryColors,
            animationDuration: 1500,
            animationEasingUpdate: 'quinticInOut',
            series: [{
                name: 'Knowledge Graph',
                type: 'graph',
                layout: 'force',
                data: graphData.nodes.map(n => ({
                    ...n,
                    symbolSize: this.getSymbolSize(n.category, graphData.categories.length),
                    label: { show: this.shouldShowLabel() }
                })),
                links: graphData.links,
                categories: graphData.categories,
                roam: true,
                draggable: true,
                label: { position: 'right', formatter: '{b}' },
                edgeSymbol: ['circle', 'arrow'],
                edgeSymbolSize: [4, 10],
                edgeLabel: { fontSize: 10 },
                force: {
                    repulsion: this.getRepulsion(),
                    edgeLength: 100,
                    gravity: 0.1
                },
                lineStyle: { color: 'source', curveness: 0.2, width: 1.5, opacity: 0.7 },
                emphasis: { focus: 'adjacency', lineStyle: { width: 4 } }
            }]
        };

        this.chart.setOption(option);
    }

    getSymbolSize(category) {
        switch (this.currentGraphType) {
            case 'person-person':
                return category === 0 ? 35 : 25;
            case 'person-object':
                return category === 0 ? 35 : (category === 1 ? 25 : 20);
            case 'area-hierarchy':
                return category === 0 ? 35 : 22;
            default:
                return category === 0 ? 35 : 25;
        }
    }

    shouldShowLabel() {
        return true; // All graphs show labels
    }

    getRepulsion() {
        switch (this.currentGraphType) {
            case 'person-person': return 400;
            case 'person-object': return 500;
            case 'area-hierarchy': return 300;
            default: return 400;
        }
    }
}
