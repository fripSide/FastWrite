

#### edit area 功能需求  

edit area支持以section/paragraph/sentence为单位进行编辑。呈现为三个界面，用户每次能选择其中一个界面。

一旦apply了下面的ai修改。就该把三个界面对应的文字都改了，首先要改原始tex文件，然后要刷新三个界面的items树。最后让用户焦点仍然留在原来的位置。（所在的哪个界面可以不刷新，只是更新text box内容。其他两个用户没有选取的界面，文字也应更新，直接刷新好像是最简单的思路）

#### 实现overleaf那样的PDF渲染和点击PDF定位 （已全部实现）

1. 最右边放一个overleaf那样PDF视图，左：proj-bar，中edit area,右pdf view

2. pdf view中点击某一行，edit area中定位到该行。同时 edit area中选择某个区域，pdf view中也跳转到该区域的文字。
实现思路：文字在文件中的位置，预估滚动距离？或者模糊匹配所在的段落，由于PDF是渲染过的，因此和原始latex不完全一致，需要模糊匹配大段内容。pdf到文件，先定位在哪个latex，再定位在哪个item。文件到pdf，也是先定位到那一页，再滚动到对应的位置，同时在pdf上闪烁高亮一下对应的段落。

3. 本地latex编译pdf，（如果没有编译环境，提示用户安装）

4. 实现统一的prompt管理，前端prompt应该由后端提供。
后端的默认prompt从本地加载，创建proj时将默认prompt存到本地。
打开项目的时候，加载prompt。这样可以每个项目都有自己独立的prompt。
前端的prompt从后端请求。并且用户修改之后可以存到本地。下次打开就又能加载上次修改的prompt。
