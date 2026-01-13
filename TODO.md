

### 功能优化

1. 把前端和后端链接起来。用同一个配置：projs/fastwrite.config.json。

2. 并且中间版本保存在对应的项目的backups目录，例如：paper/backups。

3. 选择latex文件，就从backups中加载对应文件的版本，以及diff和上一个版本的变化。显示在右边区域

4. AI Suggestions 区域，显示当前latex，逐句的编辑

5. 编辑粒度目前是一整个latex, 到时候应该会一个个section的编辑，也需要编辑一小段。一种方法是把latex拆得更细，另一种方法是选择某一subsection或者段落去编辑。有没有更好的设计？

### 功能开发

1. 基于turai界面
- 文件区


- 修改区
修改结果：diff-view，选择每一行是否需要  


 