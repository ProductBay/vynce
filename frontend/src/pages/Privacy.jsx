// src/pages/Privacy.jsx
import React from 'react';
import './Legal.css';

export default function Privacy() {
  return (
    <div className="legal-page">
      <h1>Privacy Policy</h1>
      <p className="legal-updated">Last updated: [DATE]</p>

      <p>
        This Privacy Policy explains how A&apos;Dash Technologies (“A&apos;Dash”,
        “we”, “us”, or “our”) collects, uses, and protects personal information in
        connection with the Vynce software and services (the “Service”).
      </p>
      <p>
        By using the Service, you agree to the collection and use of information
        in accordance with this Policy.
      </p>

      <div className="legal-section-divider" />

      <h2>1. Scope</h2>
      <p>
        This Policy applies to administrators, users, and agents who access the
        Service, as well as information (including contact data) that our
        customers upload or process through the Service (“Customer Data”).
      </p>
      <p>
        We provide Vynce as a business‑to‑business platform. In many cases, we act
        as a “data processor” (or equivalent term under applicable law) processing
        Customer Data on behalf of our customers (the “data controllers”).
      </p>

      <h2>2. Information We Collect</h2>

      <h3>2.1 Account &amp; Contact Information</h3>
      <p>When you create an account or contact us, we may collect:</p>
      <ul>
        <li>name, email address, and phone number;</li>
        <li>company name and role;</li>
        <li>login credentials (e.g., hashed passwords);</li>
        <li>billing and payment information (processed via secure providers).</li>
      </ul>

      <h3>2.2 Usage &amp; Log Data</h3>
      <p>When you use the Service, we may automatically collect:</p>
      <ul>
        <li>IP address, browser type, device information;</li>
        <li>access dates/times, pages viewed, and interactions;</li>
        <li>system events, error logs, and performance data.</li>
      </ul>

      <h3>2.3 Call &amp; Campaign Data (Customer Data)</h3>
      <p>
        When you use the Service for calling campaigns, we process data you or
        your systems provide, such as:
      </p>
      <ul>
        <li>contact lists (names, phone numbers, email addresses, company, etc.);</li>
        <li>call metadata (UUIDs, timestamps, status, duration, outcomes);</li>
        <li>voicemail scripts, templates, notes, and tags;</li>
        <li>
          call recordings or transcripts (if you enable such features), solely on
          your behalf.
        </li>
      </ul>
      <p>
        You are responsible for ensuring appropriate consent and notice where
        required by law when processing such data.
      </p>

      <h2>3. How We Use Information</h2>
      <p>We use information to:</p>
      <ul>
        <li>provide, operate, and maintain the Service;</li>
        <li>authenticate users and secure accounts;</li>
        <li>process calls and campaigns through integrated carriers;</li>
        <li>provide customer support and respond to inquiries;</li>
        <li>monitor performance, troubleshoot issues, and improve the Service;</li>
        <li>send important service‑related notifications;</li>
        <li>comply with legal obligations.</li>
      </ul>
      <p>We do not sell Customer Data to third parties.</p>

      <h2>4. Legal Basis (Where Applicable)</h2>
      <p>
        Where required by law (e.g., GDPR), we rely on one or more of the
        following legal bases:
      </p>
      <ul>
        <li>performance of a contract (to provide the Service);</li>
        <li>legitimate interests (e.g., improving and securing the Service);</li>
        <li>consent (for certain marketing communications where required);</li>
        <li>compliance with legal obligations.</li>
      </ul>

      <h2>5. How We Share Information</h2>
      <p>We may share information with:</p>
      <ul>
        <li>
          <strong>Service providers</strong> who help operate the Service (e.g.,
          hosting, telephony, analytics, payment processing) under appropriate
          contractual safeguards.
        </li>
        <li>
          <strong>Your organization</strong>, where your use of the Service is
          under an account controlled by your employer or organization.
        </li>
        <li>
          <strong>Legal and safety</strong>, where required to comply with law,
          court orders, or to protect rights, property, or safety.
        </li>
      </ul>
      <p>We do not sell Customer Data.</p>

      <h2>6. International Transfers</h2>
      <p>
        Information may be processed and stored in countries other than your own,
        including where our hosting providers or carriers operate. We take
        reasonable steps to ensure appropriate safeguards where required by law.
      </p>

      <h2>7. Data Retention</h2>
      <p>
        We retain information for as long as necessary to provide the Service,
        comply with legal obligations, and resolve disputes. Retention periods for
        specific data types (e.g., logs, recordings) may be configurable or
        governed by agreements with your organization.
      </p>

      <h2>8. Security</h2>
      <p>
        We implement technical and organizational measures designed to protect
        information against unauthorized access, alteration, disclosure, or
        destruction, including encryption in transit, access controls, and
        monitoring.
      </p>
      <p>
        However, no method of transmission or storage is 100% secure; we cannot
        guarantee absolute security.
      </p>

      <h2>9. Your Rights</h2>
      <p>
        Depending on your jurisdiction, you may have rights to access, correct, or
        delete certain personal information, or to object to or restrict certain
        processing. You may also have the right to data portability and to lodge a
        complaint with a supervisory authority.
      </p>
      <p>
        If you are an end contact (someone being called) and believe your data is
        processed through Vynce, please contact the organization running the
        campaigns. We may assist them in responding to your request as required by
        law.
      </p>

      <h2>10. Children’s Privacy</h2>
      <p>
        The Service is not directed to children under 16, and we do not knowingly
        collect personal information from children. If you believe a child has
        provided us personal data, please contact us and we will take appropriate
        steps.
      </p>

      <h2>11. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. If we make material
        changes, we will provide notice by updating the “Last updated” date and,
        where appropriate, through the Service or by email.
      </p>

      <h2>12. Contact Us</h2>
      <p>If you have questions or concerns about this Policy, please contact:</p>
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