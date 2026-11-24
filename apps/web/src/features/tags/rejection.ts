/**
 * 标签「换父」被拒 → 一句人话（唯一一份）。
 *
 * 与 `FolderPicker` 的 `folderRejectionMessageKey` 同一条解析
 * （`rejectionReasonOf` 只认一次错误串），但用**标签口径**的词条 ——
 * 复用「文件夹」文案会让用户读到"清单不能放进它自己"这种错位的话。
 *
 * 放在这里而不是各自的视图里：侧栏（`ProjectsPanel`）与标签管理页
 * （`TagsManager`）都要用，写两份就必然会一处跟着改、另一处不跟（AGENTS.md #4）。
 */

import type { MessageKey } from '@heyta/i18n';
import { rejectionReasonOf } from '@heyta/ui';

export function tagRejectionMessageKey(error: unknown): MessageKey {
  switch (rejectionReasonOf(error)) {
    case 'tag_not_found':
      return 'common.organizer.tag.reject.tagNotFound';
    case 'parent_not_found':
      return 'common.organizer.tag.reject.parentNotFound';
    case 'self':
      return 'common.organizer.tag.reject.self';
    case 'cycle':
      return 'common.organizer.tag.reject.cycle';
    case 'parent_not_top_level':
      return 'common.organizer.tag.reject.parentNotTopLevel';
    case 'has_children':
      return 'common.organizer.tag.reject.hasChildren';
    case 'duplicate_name':
      return 'common.organizer.tag.reject.duplicateName';
    default:
      return 'common.organizer.tag.reject.unknown';
  }
}
