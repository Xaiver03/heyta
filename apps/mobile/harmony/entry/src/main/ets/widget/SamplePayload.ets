/**
 * 示例载荷 —— **就是四端共用的那份黄金夹具**（`packages/widget-core/fixtures/v1.golden.plaintext.json`）。
 * ============================================================================================
 *
 * ## 🔴 这是**示例数据**，不是用户的真实任务，界面上必须这么写
 *
 * 鸿蒙这个应用壳目前**没有接业务数据**（它是 DevEco 模板 + 小组件宿主，
 * 真正的 RN 应用还没通过 RNOH 接进来）。而小组件的写入路径需要一个**调用点**，
 * 否则卡片会永远停在占位态。
 *
 * 所以这里的取舍是：
 * - **用真夹具当示例**，而不是随手编几行 —— 这样"卡片画出来的东西"
 *   与其它三端读的是**同一份数据**，渲染结果可以直接对比；
 * - **界面上明确写"示例数据"** —— 让用户以为这是他自己的任务，是比不显示更糟的事。
 *
 * ⚠️ 接入真实数据之后，这个文件应当**被删掉**，调用方改成读应用自己的任务。
 * 它存在本身就是"还没接线"的标记，不是设计的一部分。
 */
export const SAMPLE_PAYLOAD_JSON: string = `{
  "today": [
    {
      "id": "t_rent",
      "title": "交房租",
      "isDone": false,
      "projectId": "p_life"
    },
    {
      "id": "t_write_report",
      "title": "写周报",
      "isDone": false,
      "projectId": "p_work"
    },
    {
      "id": "t_fix_incident",
      "title": "修复线上故障",
      "isDone": false,
      "projectId": "p_work"
    },
    {
      "id": "t_buy_tape",
      "title": "买胶带",
      "isDone": false
    },
    {
      "id": "t_photo",
      "title": "整理相册",
      "isDone": false,
      "projectId": "p_plain"
    },
    {
      "id": "t_milk",
      "title": "买牛奶",
      "isDone": true,
      "projectId": "p_life"
    }
  ],
  "quadrant": {
    "1": [
      {
        "id": "t_write_report",
        "title": "写周报",
        "isDone": false,
        "projectId": "p_work",
        "quadrant": 1
      },
      {
        "id": "t_fix_incident",
        "title": "修复线上故障",
        "isDone": false,
        "projectId": "p_work",
        "quadrant": 1
      },
      {
        "id": "t_read_paper",
        "title": "读论文",
        "isDone": false,
        "quadrant": 1
      }
    ],
    "2": [
      {
        "id": "t_checkup",
        "title": "体检预约",
        "isDone": false,
        "quadrant": 2
      }
    ],
    "3": [
      {
        "id": "t_rent",
        "title": "交房租",
        "isDone": false,
        "projectId": "p_life",
        "quadrant": 3
      },
      {
        "id": "t_buy_tape",
        "title": "买胶带",
        "isDone": false,
        "quadrant": 3
      },
      {
        "id": "t_photo",
        "title": "整理相册",
        "isDone": false,
        "projectId": "p_plain",
        "quadrant": 3
      }
    ],
    "4": [
      {
        "id": "t_someday",
        "title": "有空再整理照片",
        "isDone": false,
        "quadrant": 4
      }
    ]
  },
  "habits": [
    {
      "id": "h_water",
      "title": "喝水",
      "doneToday": true,
      "streak": 3
    },
    {
      "id": "h_run",
      "title": "跑步",
      "doneToday": false,
      "streak": 3
    }
  ],
  "focus": {
    "active": true,
    "remainingSeconds": 720,
    "targetSeconds": 1500,
    "sessionTitle": "写周报",
    "endsAt": 1790565120000
  },
  "projectColors": {
    "p_life": {
      "light": "#a21caf",
      "dark": "#e879f9"
    },
    "p_work": {
      "light": "#16a34a",
      "dark": "#34d399"
    }
  }
}`;
