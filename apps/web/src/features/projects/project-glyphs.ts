/**
 * 清单图标：闭集 key → 字形（web）
 * ==================================
 *
 * 🔴 与 `../habits/habit-glyphs.ts` 同一条分工：持久化的是**闭集 key**
 * （`'briefcase'`，判定在 `@heyta/domain#project-settings.ts`），这里只把 key 映射到
 * `lucide-react` 组件。**不许**把字形名/组件名写进磁盘 —— 换图标库会改用户数据。
 *
 * ⚠️ 用 `Record<ProjectIcon, LucideIcon>` 而不是部分对象：往 `PROJECT_ICONS` 加一个
 * key 而没在这里补字形，`typecheck` 会直接指出缺哪一项（与习惯图标同一理由）。
 */
import type { LucideIcon } from 'lucide-react';
import {
  Book,
  Briefcase,
  Calendar,
  Camera,
  CheckCircle2,
  Code,
  Coffee,
  Flag,
  Folder,
  Gift,
  Heart,
  Home,
  Leaf,
  Lightbulb,
  List,
  Moon,
  Music,
  Pencil,
  Plane,
  ShoppingCart,
  Star,
  Sun,
  Target,
  Users,
  Zap,
} from 'lucide-react';

import type { ProjectIcon } from '@heyta/domain';

export const PROJECT_GLYPHS: Record<ProjectIcon, LucideIcon> = {
  list: List,
  check: CheckCircle2,
  star: Star,
  flag: Flag,
  book: Book,
  briefcase: Briefcase,
  home: Home,
  heart: Heart,
  folder: Folder,
  lightbulb: Lightbulb,
  target: Target,
  calendar: Calendar,
  music: Music,
  gift: Gift,
  coffee: Coffee,
  plane: Plane,
  code: Code,
  pencil: Pencil,
  leaf: Leaf,
  sun: Sun,
  moon: Moon,
  cart: ShoppingCart,
  camera: Camera,
  users: Users,
  zap: Zap,
};
