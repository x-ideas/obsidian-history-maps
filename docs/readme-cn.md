中文说明 | [English](../README.md)

在 [Obsidian Maps](https://github.com/obsidianmd/obsidian-maps)的基础上，增加了
1. 支持使用时间对数据进行二次过滤。

## 使用场景
* 当你有历史地图，并且希望能够查看不同年份下的数据

## 使用
有两种使用方式：
### 方式一: 在Bases中使用
1. 设置过滤条件
2. 设置坐标数据的来源(可选，默认读取md文件的`coordinates`字段作为坐标来源)
3. 设置当前时间(可选，默认读取md文件的`start`字段作为时间来源)

如
```base
filters:
  and:
    - author.contains(link("苏轼"))
views:
  - type: history-map
    name: map
    defaultYear: "1077"
```
的渲染结果为:
![base-result](./history-map-base-example.jpg)


### 方式二: 调用api接口
推荐配置[dataview](https://github.com/blacksmithgu/obsidian-dataview)一起使用

示例如下：
```dataviewjs

const points = dv().pages().where(p => {
	// 自定义筛选逻辑
	return selectTheRightFile(p);
}).filter(p => {
	// 过滤没有时间和坐标的数据
	return !!p.start && !!p.coordinates;
});

// 调用api绘制
const historyMapApi = this.app.plugins.plugins["history-maps"].api;
historyMapApi.render(this.container, {
  year: 1077,
  points: points
})

```

说明：
* 以上两种方式，对于没有`时间`或者`坐标`的数据，将会被过滤掉。请确保你的数据中包含`时间`和`坐标`。
* 上述地图来自于[history-maps](https://github.com/x-ideas/history-maps)，并使用pmtiles作为文件格式。如果提供了自定义的地图，可以通过设置或者地图的pane面板来设置包含时间数据的数据源。
* 用来过滤的时间支持的类型有，number, string，日期。如`1077`, `"1077"`, `new Date(1077, 0, 1)`。


## 安装
> 官方审核太慢，建议通过BRAT安装。
### 通过BRAT（Beta Release Automation Tool）安装
* 如果BRAT没有安装，请先安装[BRAT](https://github.com/TfTHacker/obsidian42-brat)
* 启用BRAT插件
* 使用快捷键`Ctrl+P`打开命令面板，选择`BRAT: Plugins: Add a beta plugin for test`，打开社区插件管理器
* 输入当前仓库的地址：https://github.com/x-ideas/obsidian-history-maps
* 选择一个版本（推荐最新版本）
* 点击`Add plugin`来安装
* 安装成功之后启用`History Maps`插件




