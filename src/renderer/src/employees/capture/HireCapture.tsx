// Hire Employee (`zf2Ks`) on the same fixture Edit Employee uses: Lyra, Frontend, seat 7 of 12, with
// the PERMISSIONS field open on the Company's default (T164). Nothing here ships.
import { useState } from 'react'
import type { EmployeeInput, PermissionMode } from '../../../../shared/domain/staff'
import { HireEmployeeModal } from '../../hiring/HireEmployeeModal'
import { ada, preflight, roles, servers, skills } from './EditCapture'

/**
 * The modal, live. `?permissions=<mode>` is the Company's default the field opens on, so the
 * capture can show either chip checked without the fixture being edited.
 */
export function HireCapture() {
  const [hired, setHired] = useState<EmployeeInput | null>(null)
  const asked = new URLSearchParams(location.search).get('permissions')
  const permissionDefault: PermissionMode = asked === 'interactive' ? 'interactive' : 'skip-permissions'

  return (
    <>
      <HireEmployeeModal
        companyName="Tiny Corp"
        roles={roles}
        employees={[ada]}
        former={[]}
        repoNames={['payments-web', 'web-app', 'billing-api', 'infra']}
        servers={servers}
        skills={skills}
        headcount={{ current: 6, max: 12 }}
        error={null}
        preflight={preflight}
        permissionDefault={permissionDefault}
        // The frame opens on Frontend, with the role's persona and repos already filled in.
        initialRoleId="frontend"
        initialSprite={0}
        suggestName={() => Promise.resolve('Lyra')}
        onCancel={() => setHired(null)}
        onHire={setHired}
      />
      {hired && <pre hidden>{JSON.stringify(hired)}</pre>}
    </>
  )
}
