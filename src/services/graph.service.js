import { API_CONFIG } from '../config/api.config.js';

class GraphService {
  constructor() {
    this.baseUrl = API_CONFIG.memoryGraphUrl || 'http://localhost:8000';
  }

  // ===================================================================
  // 用户画像
  // ===================================================================

  async getProfileTags(userId) {
    const url = `${this.baseUrl}/profile/${encodeURIComponent(userId)}/tags`;
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Profile Tags API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching profile tags:', error);
        throw error;
    }
  }

  async getProfileMarkdown(userId) {
    const url = `${this.baseUrl}/profile/${encodeURIComponent(userId)}/markdown`;
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Profile Markdown API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching profile markdown:', error);
        throw error;
    }
  }

  // ===================================================================
  // 机器人画像
  // ===================================================================

  async getRobotProfileTags(robotId = "office_robot") {
    const url = `${this.baseUrl}/robot/${encodeURIComponent(robotId)}/tags`;
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Robot Tags API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching robot profile tags:', error);
        throw error;
    }
  }

  async getRobotProfileMarkdown(robotId = "office_robot") {
    const url = `${this.baseUrl}/robot/${encodeURIComponent(robotId)}/markdown`;
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Robot Markdown API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching robot profile markdown:', error);
        throw error;
    }
  }

  // ===================================================================
  // Graph 1: 人-人关系图
  // ===================================================================

  async getPersonPersonGraph(userId = null, limit = 200) {
    let url = `${this.baseUrl}/graph/person-person?limit=${limit}`;
    if (userId) {
      url += `&user_id=${encodeURIComponent(userId)}`;
    }
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Person-Person Graph API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching person-person graph:', error);
        throw error;
    }
  }

  // ===================================================================
  // Graph 2: 人-物图
  // ===================================================================

  async getPersonObjectGraph(userId = null, relationType = null, limit = 200) {
    let url = `${this.baseUrl}/graph/person-object?limit=${limit}`;
    if (userId) {
      url += `&user_id=${encodeURIComponent(userId)}`;
    }
    if (relationType) {
      url += `&relation_type=${encodeURIComponent(relationType)}`;
    }
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Person-Object Graph API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching person-object graph:', error);
        throw error;
    }
  }

  // ===================================================================
  // Graph 3: 区域层次图
  // ===================================================================

  async getAreaHierarchyGraph(areaType = null, limit = 100) {
    let url = `${this.baseUrl}/graph/area-hierarchy?limit=${limit}`;
    if (areaType) {
      url += `&area_type=${encodeURIComponent(areaType)}`;
    }
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Area Hierarchy Graph API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching area hierarchy graph:', error);
        throw error;
    }
  }

  async getAreaClusters(areaType, limit = 50) {
    const url = `${this.baseUrl}/graph/area/${encodeURIComponent(areaType)}/clusters?limit=${limit}`;
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Area Clusters API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching area clusters:', error);
        throw error;
    }
  }

  // ===================================================================
  // 决策支持
  // ===================================================================

  async getDecisionSupport(userId) {
    const url = `${this.baseUrl}/decision-support/${encodeURIComponent(userId)}`;
    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error(`Decision Support API error: ${response.statusText}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching decision support:', error);
        throw error;
    }
  }
}


export const graphService = new GraphService();
