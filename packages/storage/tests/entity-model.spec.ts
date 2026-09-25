import { describe, expect, it } from 'vitest';
import { ENTITY_TYPES, isEntityType } from '@heyta/shared-schema';

/**
 * 这些测试**锁定 heyta 的实体模型设计**。
 *
 * 实体清单是客户端与服务端共享的契约，服务端会拒绝未知实体。
 * 因此它不该被随手改动 —— 改这里就应该先读
 * `packages/shared-schema/src/entity-types.ts` 顶部的设计原则。
 */
describe('heyta 实体模型', () => {
  it('无重复项', () => {
    expect(new Set(ENTITY_TYPES).size).toBe(ENTITY_TYPES.length);
  });

  it('包含 heyta 相对上游新增的三个实体', () => {
    // 这三个是 heyta 相对 Super Productivity 的实质增量：
    // 上游没有 HABIT（只有 SIMPLE_COUNTER，缺 goal/target/unit），
    // 也没有 HABIT_LOG 与 FOCUS_SESSION（它借用了通用的 METRIC）。
    expect(ENTITY_TYPES).toContain('HABIT');
    expect(ENTITY_TYPES).toContain('HABIT_LOG');
    expect(ENTITY_TYPES).toContain('FOCUS_SESSION');
  });

  it('不包含上游的 SP 专属实体', () => {
    // 这些是 Super Productivity 的产品概念，heyta 不需要。
    // 留着它们会让服务端接受永远不会出现的实体类型。
    const spOnly = [
      'SIMPLE_COUNTER',
      'WORK_CONTEXT',
      'TIME_TRACKING',
      'ISSUE_PROVIDER',
      'PLUGIN_USER_DATA',
      'PLUGIN_METADATA',
      'MENU_TREE',
      'METRIC',
    ];
    for (const entity of spOnly) {
      expect(ENTITY_TYPES, `不应包含 SP 专属实体 ${entity}`).not.toContain(entity);
    }
  });

  it('保留同步协议必需的系统实体', () => {
    // GLOBAL_CONFIG 是同步协议的基础设施（配置也需要跨端同步），
    // RECOVERY / ALL 是灾难恢复与全量导入的载体。删掉它们会破坏协议。
    expect(ENTITY_TYPES).toContain('GLOBAL_CONFIG');
    expect(ENTITY_TYPES).toContain('MIGRATION');
    expect(ENTITY_TYPES).toContain('RECOVERY');
    expect(ENTITY_TYPES).toContain('ALL');
  });

  it('不把视图建模成实体', () => {
    // 设计原则：四象限、今日、日历都由 TASK 的字段**派生**，
    // 不单独存实体 —— 否则会出现"视图数据与任务数据不一致"这类经典 bug。
    const viewLikeEntities = ['EISENHOWER', 'QUADRANT', 'TODAY', 'CALENDAR_VIEW', 'BOARD'];
    for (const entity of viewLikeEntities) {
      expect(ENTITY_TYPES, `${entity} 应派生自 TASK，不应是独立实体`).not.toContain(entity);
    }
  });

  describe('isEntityType 运行时校验', () => {
    it('接受合法实体', () => {
      expect(isEntityType('TASK')).toBe(true);
      expect(isEntityType('HABIT')).toBe(true);
    });

    it('拒绝非法输入', () => {
      expect(isEntityType('NOT_A_THING')).toBe(false);
      expect(isEntityType('')).toBe(false);
      expect(isEntityType(undefined)).toBe(false);
      expect(isEntityType(null)).toBe(false);
      expect(isEntityType(42)).toBe(false);
      expect(isEntityType({})).toBe(false);
      // 大小写敏感 —— 服务端也是精确匹配
      expect(isEntityType('task')).toBe(false);
    });
  });
});
