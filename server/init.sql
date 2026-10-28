-- ============================================
-- 节点工作流平台 - 数据库建表语句
-- 数据库: SQLite (better-sqlite3)
-- ============================================

-- ============================================
-- 表1: 画布工作流（工作台使用）
-- 存储用户在画布上创建的工作流节点和连线数据
-- ============================================
CREATE TABLE IF NOT EXISTS canvas_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '未命名工作流',
  description TEXT DEFAULT '',
  node_data TEXT NOT NULL DEFAULT '[]',
  edge_data TEXT NOT NULL DEFAULT '[]',
  viewport_x REAL DEFAULT 0,
  viewport_y REAL DEFAULT 0,
  viewport_zoom REAL DEFAULT 1,
  is_favorite INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canvas_updated ON canvas_workflows(updated_at);
CREATE INDEX IF NOT EXISTS idx_canvas_fav ON canvas_workflows(is_favorite);

-- ============================================
-- 表2: 工作流模板（工具区使用）
-- 存储 ComfyUI API 格式的工作流模板
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  content TEXT NOT NULL DEFAULT '{}',
  category TEXT DEFAULT '未分类',
  tags TEXT DEFAULT '[]',
  version INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wf_category ON workflow_templates(category);
CREATE INDEX IF NOT EXISTS idx_wf_updated ON workflow_templates(updated_at);

-- ============================================
-- 表3: ComfyUI 配置（配置中心使用）
-- 支持多个 ComfyUI 服务器配置
-- ============================================
CREATE TABLE IF NOT EXISTS comfyui_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '默认配置',
  url TEXT NOT NULL,
  timeout INTEGER DEFAULT 30000,
  auto_connect INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comfyui_active ON comfyui_configs(is_active)
  WHERE is_active = 1;

-- ============================================
-- 表4: 大模型 API 提供商配置（配置中心使用）
-- ============================================
CREATE TABLE IF NOT EXISTS llm_providers (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL DEFAULT '',
  base_url TEXT DEFAULT '',
  default_model TEXT DEFAULT '',
  temperature REAL DEFAULT 0.7,
  max_tokens INTEGER DEFAULT 4096,
  enabled INTEGER DEFAULT 1,
  extra_config TEXT DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_type ON llm_providers(provider_type);
CREATE INDEX IF NOT EXISTS idx_llm_enabled ON llm_providers(enabled);

-- ============================================
-- 表4b: 已测试通过的模型（配置中心使用）
-- 存储测试通过的大模型记录
-- ============================================
CREATE TABLE IF NOT EXISTS tested_models (
  id TEXT PRIMARY KEY,
  provider_type TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  tested_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tested_provider ON tested_models(provider_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tested_unique ON tested_models(provider_type, model_id);

-- ============================================
-- 表5: 工作流文件夹/分类（工具区使用）
-- 用于组织工作流模板的分组管理
-- ============================================
CREATE TABLE IF NOT EXISTS workflow_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_folder_order ON workflow_folders(sort_order);

-- ============================================
-- 表6: 用户偏好设置（主题等 UI 配置）
-- 简单 KV 结构，方便扩展
-- ============================================
CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- ============================================
-- 表7: 基础控件库（节点组合系统）
-- 存储可用的标准 UI 控件定义
-- ============================================
CREATE TABLE IF NOT EXISTS control_library (
  id TEXT PRIMARY KEY,
  control_type TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'basic',
  icon TEXT DEFAULT '📦',
  description TEXT DEFAULT '',
  config_schema TEXT NOT NULL DEFAULT '{}',
  default_style TEXT NOT NULL DEFAULT '{}',
  is_system INTEGER DEFAULT 1,
  is_enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 预置的 15 种基础控件
INSERT OR IGNORE INTO control_library (id, control_type, display_name, category, icon, description, config_schema, default_style, is_system, is_enabled, sort_order, created_at, updated_at) VALUES
('ctrl-label',      'label',       '文本标签',       'display',  '🏷️',  '显示静态文本或变量值',          '{"placeholder":"","maxLines":1}',            '{}', 1, 1, 1,  strftime('%s','now'), strftime('%s','now')),
('ctrl-input',      'input',       '单行输入框',     'input',    '✏️',  '文本或数值的单行输入',           '{"type":"text","maxLength":255}',          '{}', 1, 1, 2,  strftime('%s','now'), strftime('%s','now')),
('ctrl-number',     'number',      '数字输入框',     'input',    '🔢',  '数值输入，支持步进和范围',        '{"min":0,"max":100,"step":1,"precision":2}','{}', 1, 1, 3,  strftime('%s','now'), strftime('%s','now')),
('ctrl-select',     'select',      '下拉选择框',     'selection','📋',  '从预定义选项中选择一项',          '{"options":[],"multiple":false,"searchable":false}','{}', 1, 1, 4,  strftime('%s','now'), strftime('%s','now')),
('ctrl-switch',     'switch',      '开关',          'toggle',   '🔘',  '布尔值的开关切换',               '{"defaultChecked":false,"size":"default"}',   '{}', 1, 1, 5,  strftime('%s','now'), strftime('%s','now')),
('ctrl-radio',      'radio_group', '单选框组',       'selection','⚪',  '从多个选项中选择一个',            '{"options":[],"direction":"vertical"}',      '{}', 1, 1, 6,  strftime('%s','now'), strftime('%s','now')),
('ctrl-checkbox',   'checkbox_group','多选框组',     'selection','☑️',  '从多个选项中选择多个',            '{"options":[],"direction":"vertical"}',      '{}', 1, 1, 7,  strftime('%s','now'), strftime('%s','now')),
('ctrl-button',     'button',      '普通按钮',       'action',   '🔘',  '触发操作或事件',                  '{"type":"primary","size":"medium"}',       '{}', 1, 1, 8,  strftime('%s','now'), strftime('%s','now')),
('ctrl-textarea',   'textarea',    '多行文本域',     'input',    '📝',  '多行文本输入或富文本编辑',         '{"rows":4,"maxLength":5000,"richText":false}','{}', 1, 1, 9,  strftime('%s','now'), strftime('%s','now')),
('ctrl-datetime',   'datetime',    '日期时间选择器', 'input',    '📅',  '选择日期和时间',                   '{"format":"YYYY-MM-DD HH:mm","showTime":true}','{}', 1, 1, 10, strftime('%s','now'), strftime('%s','now')),
('ctrl-code_editor','code_editor', '代码编辑器',     'advanced', '💻',  '代码编写和语法高亮',               '{"language":"javascript","theme":"dark"}',  '{}', 1, 1, 11, strftime('%s','now'), strftime('%s','now')),
('ctrl-upload',     'upload',      '文件上传',       'input',    '📤',  '上传文件到服务器或本地',           '{"accept":"*/*","maxSize":10,"multiple":false}','{}', 1, 1, 12, strftime('%s','now'), strftime('%s','now')),
('ctrl-cascader',   'cascader',    '级联选择器',     'selection','🌳',  '多级联动选择',                     '{"options":[],"changeOnSelect":false}',       '{}', 1, 1, 13, strftime('%s','now'), strftime('%s','now')),
('ctrl-color_picker','color_picker','颜色选择器',    'input',    '🎨',  '选择颜色值',                       '{"format":"hex","presets":[]}',              '{}', 1, 1, 14, strftime('%s','now'), strftime('%s','now')),
('ctrl-tip',        'tip',         '提示/说明标签',   'display',  '💡',  '显示提示信息或状态徽章',           '{"variant":"info","placement":"top"}',      '{}', 1, 1, 15, strftime('%s','now'), strftime('%s','now'));

-- ============================================
-- 表8: 样式配置库（节点组合系统）
-- 存储端点、节点、控件、特效的样式预设
-- ============================================
CREATE TABLE IF NOT EXISTS style_presets (
  id TEXT PRIMARY KEY,
  preset_name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT DEFAULT '',
  config TEXT NOT NULL DEFAULT '{}',
  is_system INTEGER DEFAULT 1,
  is_enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 预置样式数据（分类: port=端点, node=节点, control=控件, effect=特效）
INSERT OR IGNORE INTO style_presets (id, preset_name, category, description, config, is_system, is_enabled, created_at, updated_at) VALUES
-- 端点样式
('port-default-circle',   '默认圆形端点',   'port',  '标准的圆形端口',          '{"shape":"circle","size":8,"borderWidth":2}', 1, 1, strftime('%s','now'), strftime('%s','now')),
('port-small-dot',       '小圆点端点',     'port',  '紧凑的小圆点',            '{"shape":"circle","size":5,"borderWidth":1}',  1, 1, strftime('%s','now'), strftime('%s','now')),
('port-square',          '方形端点',       'port',  '方形设计风格',            '{"shape":"square","size":8,"borderRadius":2}',1, 1, strftime('%s','now'), strftime('%s','now')),
('port-diamond',         '菱形端点',       'port',  '菱形特殊标记',            '{"shape":"diamond","size":10}',                  1, 1, strftime('%s','now'), strftime('%s','now')),

-- 端点颜色方案
('color-data-type',      '数据类型着色',   'port',  '根据数据类型自动着色',    '{"mode":"auto","customColor":null}',           1, 1, strftime('%s','now'), strftime('%s','now')),
('color-custom',         '自定义颜色',     'port',  '手动指定端口颜色',         '{"mode":"fixed","customColor":"#6366f1"}',     1, 1, strftime('%s','now'), strftime('%s','now')),

-- 节点样式
('node-default-dark',    '默认暗色主题',   'node',  '深色背景的节点样式',       '{"bg":{"primary":"#1a1a1e","secondary":"#252529","tertiary":"#2a2a3e"},"border":{"color":"#3a3a3e","width":1},"radius":12,"headerHeight":36}', 1, 1, strftime('%s','now'), strftime('%s','now')),
('node-modern-glass',    '现代玻璃态',     'node',  '毛玻璃效果',               '{"bg":{"primary":"rgba(30,30,40,0.8)","secondary":"rgba(40,40,55,0.9)"},"border":{"color":"rgba(255,255,255,0.1)","width":1},"backdropBlur":10,"radius":16}', 1, 1, strftime('%s','now'), strftime('%s','now')),
('node-minimal',        '极简风格',       'node',  '扁平化无阴影',             '{"bg":{"primary":"#ffffff","secondary":"#f8f9fa"},"border":{"color":"#e5e7eb","width":1},"shadow":"none","radius":8}', 1, 1, strftime('%s','now'), strftime('%s','now')),

-- 控件样式
('control-comfyui',     'ComfyUI 风格',   'control','匹配 ComfyUI 的控件外观',  '{"inputBg":"#252529","borderColor":"#3a3a3e","focusColor":"#6366f1","textColor":"#e8e8ed","fontSize":12}', 1, 1, strftime('%s','now'), strftime('%s','now')),
('control-modern',      '现代简约',       'control','简洁现代的控件样式',       '{"inputBg":"#ffffff","borderColor":"#d1d5db","focusColor":"#3b82f6","textColor":"#111827","fontSize":13}', 1, 1, strftime('%s','now'), strftime('%s','now')),

-- 运行时特效
('effect-pulse-success','成功脉冲',       'effect','执行成功时的脉冲动画',     '{"type":"pulse","color":"#22c55e","duration":1000,"repeat":2}', 1, 1, strftime('%s','now'), strftime('%s','now')),
('effect-pulse-error',  '错误闪烁',       'effect','出错时的红色闪烁',         '{"type":"blink","color":"#ef4444","duration":500,"repeat":3}', 1, 1, strftime('%s','now'), strftime('%s','now')),
('effect-glow-active',  '激活发光',       'effect','节点激活时的发光效果',     '{"type":"glow","color":"#6366f1","intensity":20,"spread":10}', 1, 1, strftime('%s','now'), strftime('%s','now'));

-- ============================================
-- 表11: 文档库分类（文档库使用）
-- 用户可自行增/删/改/查的文档分类
-- ============================================
CREATE TABLE IF NOT EXISTS doc_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_doc_category_order ON doc_categories(sort_order);

-- ============================================
-- 表12: 文档库文档（文档库使用）
-- 每篇文档归属一个分类，正文以纯文本存储
-- ============================================
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (category_id) REFERENCES doc_categories(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at);
