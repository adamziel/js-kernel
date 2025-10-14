* Support shell scripts with bash-like syntax.
    ✅ Integrate shell parser, e.g. https://github.com/raphamorim/flash.
    * Add a system() function that can be used to execute shell commands.
	* Support shebang in scripts in general.
* Support interpreters
	✅ /bin/js
	✅ /bin/sh
	✅ /bin/php
* Support more programs
    ✅ /bin/node
    * /bin/npm
* Support multiple filesystems
    * Fast SharedArrayBuffer filesystem
    * Centralized OPFS (goes through kernel worker)
    * Decentralized OPFS (handled by each child process)
* Support a shell process with interactive mode that gets stdio from xterm.js and
  outputs control sequences to xterm.js. For example, when the user types a character,
  the shell process needs to see it immediately on stdin and decide what to do with it.
  Could be running a program, could be extending an internal buffer, could be moving
  the cursor to the beginning of the line or next word, etc.
* Debug mode where we see all the output of all processes in the browser's terminal