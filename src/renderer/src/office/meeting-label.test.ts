import { describe, expect, it } from 'vitest'
import { inside, officeLayout } from '../../../shared/office/layout'
import { ROOMS } from '../../../shared/office/rooms'
import { createMeetingLabel, meetingLabel, meetingLabelSpot } from './meeting-label'

const measured = ROOMS.filter((room) => room.geometry !== null)

describe('the label on the glass room', () => {
  it('counts the meeting, four or more: the room says how many it is for', () => {
    expect(meetingLabel(4)).toBe('Meeting · 4')
    expect(meetingLabel(6)).toBe('Meeting · 6')
  })

  it('is off the glass while no meeting is on, and back on it with one', () => {
    const label = createMeetingLabel(officeLayout().meetingArea)

    label.set(0)
    expect(label.node.visible).toBe(false)

    label.set(6)
    expect({ visible: label.node.visible, text: label.node.text }).toEqual({ visible: true, text: 'Meeting · 6' })

    label.set(0)
    expect(label.node.visible).toBe(false)
  })

  it('hangs over the meeting room floor, below every chair at its table, in every measured room', () => {
    for (const room of measured) {
      const layout = officeLayout(room.geometry!)
      const at = meetingLabelSpot(layout.meetingArea)

      expect(inside(at, layout.meetingArea), `${room.slug} label off the meeting floor`).toBe(true)
      for (const chair of layout.meeting) {
        expect(at.y, `${room.slug} label over a sitter`).toBeGreaterThanOrEqual(chair.y)
      }
    }
  })
})
