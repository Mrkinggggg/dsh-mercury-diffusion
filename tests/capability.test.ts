import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyProbe } from '../src/capability.ts'

/** Verbatim Inception errors, captured from the live endpoint through a gateway. */
const BASELINE = '{"error":{"code":"invalid_request_error","message":"inception: 400 Bad Request: {\\"error\\":{\\"message\\":[{\\"type\\":\\"value_error\\",\\"loc\\":[\\"body\\",\\"messages\\"],\\"msg\\":\\"Value error, At least one message is required\\"}]}}"}}'
const KNOWS_FIELD = '{"error":{"code":"invalid_request_error","message":"inception: 400 Bad Request: {\\"error\\":{\\"message\\":[{\\"type\\":\\"value_error\\",\\"loc\\":[\\"body\\",\\"messages\\"]},{\\"type\\":\\"bool_parsing\\",\\"loc\\":[\\"body\\",\\"diffusing\\"],\\"msg\\":\\"Input should be a valid boolean, unable to interpret input\\"}]}}"}}'
const EXTRA_KEY = '{"detail":[{"type":"extra_forbidden","loc":["body","diffusing"],"msg":"Extra inputs are not permitted"}]}'

describe('classifyProbe', () => {
  it('confirms a route that validates the field', () => {
    assert.equal(classifyProbe(400, KNOWS_FIELD), 'yes')
  })

  it('refuses a strict route that calls the field an extra key', () => {
    assert.equal(classifyProbe(422, EXTRA_KEY), 'no')
  })

  it('stays undecided when the field is simply ignored', () => {
    assert.equal(classifyProbe(400, BASELINE), 'unknown')
  })

  it('stays undecided on auth failures and unexpected successes', () => {
    assert.equal(classifyProbe(401, '{"error":{"message":"Incorrect API key provided"}}'), 'unknown')
    assert.equal(classifyProbe(200, 'data: {"choices":[]}'), 'unknown')
  })

  it('stays undecided on transport-level server errors', () => {
    assert.equal(classifyProbe(500, '{"error":{"message":"boom"}}'), 'unknown')
  })
})
