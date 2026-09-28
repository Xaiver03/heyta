import { WidgetCardRoot } from './WidgetCardRoot';

/**
 * Today 卡片的**入口**（平台要求每张卡片有独立的一页）。
 *
 * ⚠️ 这里**只有接线**，一行渲染逻辑都没有 —— 渲染在 `WidgetCardRoot` 里，
 * 四张卡片共用。抄四遍的漂移表现是"四款里只有一款在过期之后还显示昨天的数据"。
 */
@Entry
@Component
struct TodayCard {
  build() {
    // ⚠️ `@Entry` 的 `build()` **只能有一个根节点，且必须是容器组件** ——
    //    直接返回一个自定义组件会报
    //    `the 'build' method can have only one root node, which must be a container component`。
    //    （这条报错落在 `struct` 那一行上，不在 `build` 里，很容易看错地方。）
    Column() {
      WidgetCardRoot({ kind: 'today' })
    }
    .width('100%')
    .height('100%')
  }
}
