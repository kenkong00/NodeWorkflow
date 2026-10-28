export interface CanvasWorkflow {
  id: string
  name: string
  description: string
  node_data: string
  edge_data: string
  viewport_x: number
  viewport_y: number
  viewport_zoom: number
  is_favorite: number
  created_at: number
  updated_at: number
}

export interface WorkflowTemplate {
  id: string
  name: string
  description: string
  content: string
  category: string
  tags: string
  version: number
  created_at: number
  updated_at: number
}

export interface ComfyUIConfig {
  id: string
  name: string
  url: string
  timeout: number
  auto_connect: number
  is_active: number
  notes: string
  created_at: number
  updated_at: number
}

export interface LLMProvider {
  id: string
  provider_type: string
  name: string
  api_key: string
  base_url: string
  default_model: string
  temperature: number
  max_tokens: number
  enabled: number
  extra_config: string
  created_at: number
  updated_at: number
}

export interface WorkflowFolder {
  id: string
  name: string
  sort_order: number
  created_at: number
}

export interface UserSetting {
  key: string
  value: string
  updated_at: number
}

export interface TestedModel {
  id: string
  name: string
  testedAt: string
}
