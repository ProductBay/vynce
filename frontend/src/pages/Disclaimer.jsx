// src/pages/Disclaimer.jsx
import React from 'react';
import './Legal.css';

export default function Disclaimer() {
  return (
    <div className="legal-page">
      <h1>Disclaimer</h1>
      <p className="legal-updated">Last updated: [DATE]</p>

      <h2>1. Software Only – No Call Center Services</h2>
      <p>
        Vynce is a software platform provided by A&apos;Dash Technologies
        (“A&apos;Dash”). We provide tools that call centers, sales teams, and
        other organizations can use to manage and automate their own
        communications.
      </p>
      <p>
        A&apos;Dash does <strong>not</strong> operate a call center or business
        process outsourcing (BPO) service, does <strong>not</strong> employ or
        manage agents to place calls on behalf of customers, and does
        <strong> not</strong> provide telemarketing services directly to end
        consumers.
      </p>
      <p>
        You, as the customer, are solely responsible for your own business
        operations, agents, and interactions with your contacts.
      </p>

      <h2>2. No Legal or Compliance Advice</h2>
      <p>
        Nothing in the Service, documentation, or related materials should be
        interpreted as legal, regulatory, or compliance advice. Laws and
        regulations applicable to telemarketing, robocalls, consent, data
        protection, and privacy are complex and vary by jurisdiction.
      </p>
      <p>
        You are solely responsible for obtaining your own legal advice regarding
        the use of Vynce, determining whether your intended use complies with
        applicable laws, and configuring the Service (including contact lists,
        call flows, scripts, and voicemails) in compliance with those laws.
      </p>

      <h2>3. Responsibility for Content and Contacts</h2>
      <p>You are solely responsible for:</p>
      <ul>
        <li>the accuracy and legality of the contact data you upload or process;</li>
        <li>obtaining valid consent from recipients where required by law;</li>
        <li>the content of all calls, messages, scripts, and recordings;</li>
        <li>honoring opt‑out and Do‑Not‑Call (DNC) requests;</li>
        <li>ensuring your agents and contractors follow applicable laws and policies.</li>
      </ul>
      <p>
        A&apos;Dash does not monitor, approve, or endorse the specific content of
        any communications you send using the Service.
      </p>

      <h2>4. Third‑Party Services</h2>
      <p>
        The Service may integrate or rely on third‑party providers such as
        telephony/VoIP carriers, cloud infrastructure, and analytics tools.
        A&apos;Dash does not control these third‑party services and is not
        responsible for:
      </p>
      <ul>
        <li>dropped calls, connection failures, or poor call quality;</li>
        <li>changes in pricing, coverage, or availability by third‑party providers;</li>
        <li>any damage or loss resulting from the use of third‑party services.</li>
      </ul>

      <h2>5. No Guarantee of Results</h2>
      <p>
        While Vynce is designed to assist with outreach and calling campaigns, we
        do not guarantee any particular results, including but not limited to:
      </p>
      <ul>
        <li>the number of leads generated;</li>
        <li>successful contact or answer rates;</li>
        <li>sales, conversions, or revenue increases.</li>
      </ul>
      <p>
        Your outcomes depend on many factors, including your data quality,
        scripts, agents, timing, and market conditions.
      </p>

      <h2>6. Limitation of Liability</h2>
      <p>
        To the fullest extent permitted by law, A&apos;Dash shall not be liable
        for any indirect, incidental, consequential, or special damages arising
        out of or in connection with your use of the Service, including but not
        limited to lost profits, lost business, or loss of data.
      </p>
      <p>
        For full limitations of liability, please refer to our Terms of Use.
      </p>

      <h2>7. Contact</h2>
      <p>If you have any questions about this Disclaimer, please contact:</p>
      <p>
        A&apos;Dash Technologies
        <br />
        Jamaica
        <br />
        Phone / WhatsApp: +1 (876) 594‑7320
        <br />
        Email: support@adashtech.com / ashandie@adashtech.com
      </p>
    </div>
  );
}