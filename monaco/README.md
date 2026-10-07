Monaco Editor
=============

This directory holds a copy of the Monaco Editor, used by the monaco and
monaco_multifile UI plugins.

Version: 0.52.0 (f6dc0eb8fce67e57f6036f4769d92c1666cdf546)
Source:  https://github.com/microsoft/monaco-editor
License: MIT (see LICENSE.txt in this directory)

The files under vs/ are the distributed build of that release and are not
modified here. The file icons and the One Dark/One Light themes the Monaco UIs
also use are separate third-party libraries, kept under ../thirdparty/.

To upgrade, replace the vs/ directory with the contents of the
`min` (or `dev`) folder of a newer monaco-editor release and update the version
recorded here and in ../thirdpartylibs.xml.
