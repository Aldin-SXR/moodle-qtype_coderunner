# CodeRunner

Version: 5.10.6 September 26, 2026. Requires **MOODLE V4.3 or later + PHP >=8.1**. Earlier versions
of Moodle must use CodeRunner V4.

CodeRunner is a Moodle question type that allows teachers to run a program in
order to grade a student's answer. By far the most common use of CodeRunner is
in programming courses where students are asked to write program code to some
specification and that code is then graded by running it in a series of tests.
CodeRunner questions have also been used in other areas of computer science and
engineering to grade questions in which a program must be used to assess correctness.


Authors: Richard Lobb, University of Canterbury, New Zealand.
         Paul McKeown, University of Canterbury, New Zealand.
         Tim Hunt, The Open University, UK.


For full documentation, see [https://trampgeek.github.io/moodle-qtype_coderunner/](https://trampgeek.github.io/moodle-qtype_coderunner/)

NOTE: A few sample quizzes containing example CodeRunner questions
are available at [coderunner.org.nz](http://coderunner.org.nz). There's also
[a forum](http://coderunner.org.nz/mod/forum/view.php?id=51) there, where you
can post CodeRunner questions, such as
requests for help if things go wrong, or are looking for ideas on how to write some
unusual question type.


## Question types that need a customised Jobe server

This fork adds some built-in question types that standard Jobe
([JobeInABox](https://github.com/trampgeek/jobeinabox)) cannot run. They appear
in the question type menu on every site, but on a standard Jobe server every run
fails. Each type's help text gives the details.

| Question type | Needs on the Jobe server |
|---|---|
| kotlin_program, kotlin_function | A Jobe language named `kotlin` (kotlinc and a JRE) |
| kotlin_compose | A Jobe language named `kotlin_compose` (Compose compiler plugin and classpath, xvfb-run) |
| typescript | `tsc` (npm package `typescript`) on the PATH |
| mysql | Python package `mysql-connector-python`, plus a reachable MySQL server |
| mongodb | Python package `pymongo`, plus a reachable MongoDB server |
| solidity | Foundry (`forge`) and the forge-std library |

The multifile_cpp, multifile_java and multifile_html types run on standard Jobe.
