### 检查并实现以下功能


#### 左边的outline支持多文件和单文件latex  
- [x] outline应该读取右边的compile选项选中的main文件，如果是分拆pdf，应该解析多个latex input，把section都加载进来，一起构建一个完整的论文的outline。并且点击对应的section应该在edit area中定位到该section。

#### 某一段修改，提供多个修改版本，让用户选择  
gemini等模型，有时候会输出多个版本，需要给出每个版本的特点和理由，以及diff view。让用户选择

#### 在左边side bar支持一个notes视图方便记录笔记
在里面新建notes文件，可以记录某一节的写作思路。
给ai发消息的时候，可以@引用这些文件。at的文件被预处理，加载到user input里面，作为message。


#### 优化编辑器视图

paragraph/sentence模式，目前是否兼容注释。
同时一个文件太长会怎么样，会不会不容易找到想改的句子

#### Diagnose高级模式  
诊断模式，需要支持agent去读本地文件。需要一个tools去找文件，并中间相关段。提炼论文的意思。
实现简单agent支持，解析章节结构，根据论文主题，给出论文布局建议。


### 检查并修复以下Bug
