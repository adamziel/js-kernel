* Support shell scripts with bash-like syntax.
    * Integrate shell parser, e.g. https://github.com/raphamorim/flash.
    * Add a system() function that can be used to execute shell commands.
	* Support shebang in scripts in general.
* Support interpreters
	* /bin/js
	* /bin/sh
	* /bin/php
* Support more programs
    * /bin/node
    * /bin/npm
* Support multiple filesystems
    * Fast SharedArrayBuffer filesystem
    * Centralized OPFS (goes through kernel worker)
    * Decentralized OPFS (handled by each child process)
