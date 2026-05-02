import fs from 'fs'
import { Template } from 'e2b'

const dockerfile = fs.readFileSync('./Dockerfile', 'utf8')

export const template = Template().fromDockerfile(dockerfile)
