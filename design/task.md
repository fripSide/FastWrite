

### Your Task

implementing an acadima writing helper to improve paper writing.
It first load the `system.md` as system prompt.

The paper is in latex format and each of its sections are in seperate latex file and put in a direectory named sections. 
The file of each section is named as "id-filename", e.g., 0-abstract, 1-introduction, and etc.

Then it scan the latex files of each sections (in section directory) and create a markdown file for each latex file.

Users can write their own modification requirments in this markdown file.

The AI writing helper invoke LLM apis to load this markdown file and system prompt to generate a new latex section file while backing up the original section file.

The LLM writing helpers should follow the requirements in the makrdown to finish the task descript in it and genreate a new section file.


Users can check the modified new section file and the LLM helper should generate a html diff file for users to check how each sensentce are modified.

## Features

These feature have be done: 

[01-prepare-command.md](01-prepare-command.md)   
[02-write-command.md](01-write-command.md)
