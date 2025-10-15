import { lsProgramSource } from './ls.ts'
import { mkdirProgramSource } from './mkdir.ts'
import { cpProgramSource } from './cp.ts'
import { mvProgramSource } from './mv.ts'
import { rmProgramSource } from './rm.ts'
import { touchProgramSource } from './touch.ts'
import { catProgramSource } from './cat.ts'
import { echoProgramSource } from './echo.ts'
import { headProgramSource } from './head.ts'
import { tailProgramSource } from './tail.ts'
import { envProgramSource } from './env.ts'
import { lnProgramSource } from './ln.ts'
import { pwdProgramSource } from './pwd.ts'
import { cdProgramSource } from './cd.ts'
import { shProgramSource } from './sh.ts'
import { type Kernel } from '../index.ts'
import { joinPaths } from '../util/paths.ts'
import { ttyShellProgramSource } from './tty-shell.ts'

export const busyboxPrograms: Record<string, string> = {
	ls: lsProgramSource,
	mkdir: mkdirProgramSource,
	cp: cpProgramSource,
	mv: mvProgramSource,
	rm: rmProgramSource,
	touch: touchProgramSource,
	cat: catProgramSource,
	echo: echoProgramSource,
	head: headProgramSource,
	tail: tailProgramSource,
	env: envProgramSource,
	ln: lnProgramSource,
	pwd: pwdProgramSource,
	cd: cdProgramSource,
	sh: shProgramSource,
	'tty-shell': ttyShellProgramSource,
}

export type BusyboxProgramName = keyof typeof busyboxPrograms

// Initiate busybox programs
export function installBusybox(kernel: Kernel, path = '/bin') {
	kernel.mkdirSync(path, { mode: 0o755 })
	for (const [name, source] of Object.entries(busyboxPrograms)) {
		kernel.writeFileSync(joinPaths(path, name), `${source}\n`, {
			mode: 0o755,
		})
	}
}
