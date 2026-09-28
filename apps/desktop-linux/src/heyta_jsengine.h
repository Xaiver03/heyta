#ifndef HEYTA_JSENGINE_H
#define HEYTA_JSENGINE_H

/*
 * JavaScriptCore 的**伞头文件在两端不叫同一个名字**：
 *
 *   macOS ： <JavaScriptCore/JavaScriptCore.h>   （Xcode SDK 自带）
 *   Linux ： <JavaScriptCore/JavaScript.h>       （来自 libjavascriptcoregtk-4.1-dev）
 *
 * 引擎是同一个（这也正是选它的理由），只有头文件名不同 —— 所以只在这一处处理，
 * 不让 `#ifdef __APPLE__` 散落到每个 .c 里。
 *
 * ⚠️ Linux 上**没有** `JavaScriptCore.h` 这个文件。第一次编译报的是
 *    `fatal error: JavaScriptCore/JavaScriptCore.h: No such file or directory`，
 *    而目录里明明有一堆 JS*.h —— 缺的就是那个伞文件。
 */

#if defined(__APPLE__)
#include <JavaScriptCore/JavaScriptCore.h>
#else
#include <JavaScriptCore/JavaScript.h>
#endif

#endif /* HEYTA_JSENGINE_H */
