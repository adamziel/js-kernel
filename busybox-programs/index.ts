import { lsProgramSource } from './ls.ts'
import { mkdirProgramSource } from './mkdir.ts'
import { cpProgramSource } from './cp.ts'
import { mvProgramSource } from './mv.ts'
import { rmProgramSource } from './rm.ts'
import { touchProgramSource } from './touch.ts'
import { catProgramSource } from './cat.ts'
import { headProgramSource } from './head.ts'
import { tailProgramSource } from './tail.ts'
import { envProgramSource } from './env.ts'
import { lnProgramSource } from './ln.ts'
import { pwdProgramSource } from './pwd.ts'
import { cdProgramSource } from './cd.ts'

export const busyboxPrograms: Record<string, string> = {
	ls: lsProgramSource,
	mkdir: mkdirProgramSource,
	cp: cpProgramSource,
	mv: mvProgramSource,
	rm: rmProgramSource,
	touch: touchProgramSource,
	cat: catProgramSource,
	head: headProgramSource,
	tail: tailProgramSource,
	env: envProgramSource,
	ln: lnProgramSource,
	pwd: pwdProgramSource,
	cd: cdProgramSource,
}

export type BusyboxProgramName = keyof typeof busyboxPrograms
